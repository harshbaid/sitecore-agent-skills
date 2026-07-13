import { agentRequest, newJobId, type AgentResponse } from './agent-client.js';
import type { EnvName } from './config.js';

/**
 * Wrappers over Sitecore Agent API v2.0 (REST). Shapes verified from the OpenAPI v2.0 spec.
 * Writes accept an optional jobId; if omitted one is generated and returned so the change is
 * revertable via revertJob().
 */

type FieldMap = Record<string, string>;

// ---------- SITES ----------

export const listSites = (env: EnvName) => agentRequest(env, 'GET', '/api/v1/sites');
export const getSite = (env: EnvName, siteId: string) =>
  agentRequest(env, 'GET', `/api/v1/sites/${encodeURIComponent(siteId)}`);
export const listSitePages = (env: EnvName, siteName: string, language?: string) =>
  agentRequest(env, 'GET', `/api/v1/sites/${encodeURIComponent(siteName)}/pages`, {
    query: { language },
  });
export const siteIdFromItem = (env: EnvName, itemId: string) =>
  agentRequest(env, 'GET', `/api/v1/sites/site-id-from-item/${encodeURIComponent(itemId)}`);

// ---------- PAGES ----------

export const getPage = (env: EnvName, pageId: string) =>
  agentRequest(env, 'GET', `/api/v1/pages/${encodeURIComponent(pageId)}`);
export const searchPages = (env: EnvName, site: string, term: string) =>
  agentRequest(env, 'GET', '/api/v1/pages/search', { query: { site, term } });
export const getComponentsOnPage = (env: EnvName, pageId: string) =>
  agentRequest(env, 'GET', `/api/v1/pages/${encodeURIComponent(pageId)}/components`);

export function createPage(
  env: EnvName,
  args: { templateId: string; name: string; parentId: string; language?: string; fields?: FieldMap },
  jobId = newJobId()
): Promise<AgentResponse> {
  return agentRequest(env, 'POST', '/api/v1/pages/create', {
    jobId,
    body: {
      templateId: args.templateId,
      name: args.name,
      parentId: args.parentId,
      language: args.language ?? 'en',
      fields: args.fields ? Object.entries(args.fields).map(([name, value]) => ({ name, value })) : null,
    },
  });
}

// ---------- CONTENT ----------

export const getContentByPath = (
  env: EnvName,
  itemPath: string,
  language?: string,
  failOnNotFound?: boolean
) =>
  agentRequest(env, 'GET', '/api/v1/content', {
    query: { item_path: itemPath, language, failOnNotFound },
  });

export const getContentById = (env: EnvName, itemId: string) =>
  agentRequest(env, 'GET', `/api/v1/content/${encodeURIComponent(itemId)}`);

export const listInsertOptions = (env: EnvName, itemId: string) =>
  agentRequest(env, 'GET', `/api/v1/content/${encodeURIComponent(itemId)}/insert-options`);

export function createContent(
  env: EnvName,
  args: { templateId: string; name: string; parentId: string; language?: string; fields?: FieldMap },
  jobId = newJobId()
): Promise<AgentResponse> {
  return agentRequest(env, 'POST', '/api/v1/content/create', {
    jobId,
    body: {
      templateId: args.templateId,
      name: args.name,
      parentId: args.parentId,
      language: args.language ?? 'en',
      fields: args.fields ?? null,
    },
  });
}

export function updateContent(
  env: EnvName,
  itemId: string,
  args: { fields: FieldMap; language?: string; createNewVersion?: boolean; siteName?: string },
  jobId = newJobId()
): Promise<AgentResponse> {
  return agentRequest(env, 'PUT', `/api/v1/content/${encodeURIComponent(itemId)}`, {
    jobId,
    body: {
      fields: args.fields,
      language: args.language ?? 'en',
      createNewVersion: args.createNewVersion ?? false,
      siteName: args.siteName ?? null,
    },
  });
}

export function deleteContent(
  env: EnvName,
  itemId: string,
  language?: string,
  jobId = newJobId()
): Promise<AgentResponse> {
  return agentRequest(env, 'DELETE', `/api/v1/content/${encodeURIComponent(itemId)}`, {
    jobId,
    query: { language },
  });
}

// ---------- ENVIRONMENTS ----------

export const listLanguages = (env: EnvName) =>
  agentRequest(env, 'GET', '/api/v1/environments/languages');

// ---------- JOBS (tracking + revert) ----------

export const getJob = (env: EnvName, jobId: string) =>
  agentRequest(env, 'GET', `/api/v1/jobs/${encodeURIComponent(jobId)}`);
export const listJobOperations = (env: EnvName, jobId: string) =>
  agentRequest(env, 'GET', `/api/v1/jobs/${encodeURIComponent(jobId)}/operations`);
export const revertJob = (env: EnvName, jobId: string) =>
  agentRequest(env, 'POST', `/api/v1/jobs/${encodeURIComponent(jobId)}/revert`);
