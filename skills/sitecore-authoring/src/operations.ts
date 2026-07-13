import { gql, fanOut, type FanOutResult } from './client.js';
import type { EnvName } from './config.js';

/**
 * Operation wrappers over the XM Cloud Authoring & Management GraphQL API.
 * Input shapes verified by live schema introspection against the DEV CM.
 */

export type ItemRef = { path?: string; itemId?: string };
export type FieldValue = { name: string; value?: string; reset?: boolean };

export type ItemResult = {
  itemId: string;
  name: string;
  path: string;
  displayName: string;
  template: { templateId: string; name: string };
  fields: { nodes: { name: string; value: string }[] };
};

function refArgs(ref: ItemRef): Record<string, unknown> {
  if (!ref.path && !ref.itemId) throw new Error('Provide --path or --id');
  return { path: ref.path ?? null, itemId: ref.itemId ?? null };
}

// ---------- READ ----------

const ITEM_FIELDS = `
  itemId name path displayName
  template { templateId name }
`;

/** Fetch an item with optional named fields (omit names to get all own + inherited fields). */
export async function getItem(
  env: EnvName,
  ref: ItemRef,
  opts: { language?: string; fieldNames?: string[]; ownFieldsOnly?: boolean } = {}
): Promise<ItemResult | null> {
  const language = opts.language ?? 'en';
  const fieldSelection =
    opts.fieldNames && opts.fieldNames.length
      ? opts.fieldNames
          .map(
            (n, i) =>
              `f${i}: field(name: ${JSON.stringify(n)}) { name value }`
          )
          .join('\n')
      : `fields(ownFields: ${opts.ownFieldsOnly ? 'true' : 'false'}) { nodes { name value } }`;

  const query = `
    query Get($path: String, $itemId: ID, $language: String) {
      item(where: { path: $path, itemId: $itemId, language: $language }) {
        ${ITEM_FIELDS}
        ${fieldSelection}
      }
    }`;
  const data = await gql<{ item: any }>(env, query, { ...refArgs(ref), language });
  if (!data.item) return null;

  // Normalise aliased single-field selections into the fields.nodes shape,
  // then strip the temporary f0/f1/... aliases so output is clean.
  if (opts.fieldNames && opts.fieldNames.length) {
    const nodes = opts.fieldNames
      .map((_, i) => data.item[`f${i}`])
      .filter(Boolean)
      .map((f: any) => ({ name: f.name, value: f.value }));
    opts.fieldNames.forEach((_, i) => delete data.item[`f${i}`]);
    data.item.fields = { nodes };
  }
  return data.item as ItemResult;
}

// ---------- WRITE: update fields ----------

export async function updateItem(
  env: EnvName,
  ref: ItemRef,
  fields: FieldValue[],
  opts: { language?: string; version?: number } = {}
): Promise<ItemResult> {
  const mutation = `
    mutation Update($input: UpdateItemInput!) {
      updateItem(input: $input) {
        item { ${ITEM_FIELDS} fields(ownFields: true) { nodes { name value } } }
      }
    }`;
  const input: Record<string, unknown> = {
    ...refArgs(ref),
    language: opts.language ?? 'en',
    fields,
  };
  if (opts.version != null) input.version = opts.version;
  const data = await gql<{ updateItem: { item: ItemResult } }>(env, mutation, { input });
  return data.updateItem.item;
}

// ---------- WRITE: create ----------

export async function createItem(
  env: EnvName,
  args: {
    parent: string; // parent item ID or path (ID! in schema; path also accepted)
    templateId: string;
    name: string;
    language?: string;
    fields?: FieldValue[];
  }
): Promise<ItemResult> {
  const mutation = `
    mutation Create($input: CreateItemInput!) {
      createItem(input: $input) {
        item { ${ITEM_FIELDS} }
      }
    }`;
  const input: Record<string, unknown> = {
    parent: args.parent,
    templateId: args.templateId,
    name: args.name,
    language: args.language ?? 'en',
  };
  if (args.fields?.length) input.fields = args.fields;
  const data = await gql<{ createItem: { item: ItemResult } }>(env, mutation, { input });
  return data.createItem.item;
}

// ---------- WRITE: move ----------

export async function moveItem(
  env: EnvName,
  ref: ItemRef,
  target: { targetParentPath?: string; targetParentId?: string; sortOrder?: number }
): Promise<{ itemId: string; path: string }> {
  const mutation = `
    mutation Move($input: MoveItemInput!) {
      moveItem(input: $input) { item { itemId path } }
    }`;
  const input: Record<string, unknown> = {
    ...refArgs(ref),
    targetParentPath: target.targetParentPath ?? null,
    targetParentId: target.targetParentId ?? null,
  };
  if (target.sortOrder != null) input.sortOrder = target.sortOrder;
  const data = await gql<{ moveItem: { item: any } }>(env, mutation, { input });
  return data.moveItem.item;
}

// ---------- WRITE: rename ----------

export async function renameItem(
  env: EnvName,
  ref: ItemRef,
  newName: string
): Promise<{ itemId: string; name: string; path: string }> {
  const mutation = `
    mutation Rename($input: RenameItemInput!) {
      renameItem(input: $input) { item { itemId name path } }
    }`;
  const data = await gql<{ renameItem: { item: any } }>(env, mutation, {
    input: { ...refArgs(ref), newName },
  });
  return data.renameItem.item;
}

// ---------- WRITE: delete ----------

export async function deleteItem(
  env: EnvName,
  ref: ItemRef,
  permanently = false
): Promise<{ successful: boolean }> {
  const mutation = `
    mutation Delete($input: DeleteItemInput!) {
      deleteItem(input: $input) { successful }
    }`;
  const data = await gql<{ deleteItem: { successful: boolean } }>(env, mutation, {
    input: { ...refArgs(ref), permanently },
  });
  return data.deleteItem;
}

// ---------- CROSS-ENV COMPARE ----------

export type CompareRow = {
  field: string;
  values: Record<EnvName, string | '(missing item)' | '(error)'>;
  inSync: boolean;
};

/** Compare named field values for the same item across environments. */
export async function compareAcrossEnvs(
  envs: EnvName[],
  ref: ItemRef,
  fieldNames: string[],
  language = 'en'
): Promise<{ results: FanOutResult<ItemResult | null>[]; rows: CompareRow[] }> {
  const results = await fanOut(envs, (env) => getItem(env, ref, { language, fieldNames }));

  const valueFor = (env: EnvName, field: string): string | '(missing item)' | '(error)' => {
    const r = results.find((x) => x.env === env)!;
    if (!r.ok) return '(error)';
    if (!r.value) return '(missing item)';
    return r.value.fields.nodes.find((n) => n.name === field)?.value ?? '';
  };

  const rows: CompareRow[] = fieldNames.map((field) => {
    const values = Object.fromEntries(envs.map((e) => [e, valueFor(e, field)])) as Record<
      EnvName,
      string | '(missing item)' | '(error)'
    >;
    const distinct = new Set(Object.values(values));
    return { field, values, inSync: distinct.size === 1 };
  });

  return { results, rows };
}
