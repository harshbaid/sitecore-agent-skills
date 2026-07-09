# sitecore-agent-skills

Agent skills for Sitecore work. Each skill packages a task an AI coding agent
(Claude Code, Cursor, or anything that can read Markdown and run a script) can
carry out end to end - so you ask for the outcome instead of clicking through
a UI or hand-assembling API calls.

> "Move `/sitecore/content/MySite/Home` from PROD to DEV" - and the agent
> authenticates, relays the chunks, consumes the file, verifies per item, and
> reminds you to publish. That is the whole interaction.

## Why agent skills?

The Sitecore community has been closing the gap left by the retired Package
Designer from three directions:

1. **Know the APIs** - [Chirag Khanna's deep dive](https://sitecorefoundation.wordpress.com/2026/07/08/the-new-way-to-migrate-sitecore-content-content-transfer-api-and-item-transfer-api-explained/)
   into the Content Transfer + Item Transfer APIs, with a
   [Postman collection](https://github.com/ckhanna2808/contenttransferitemapi).
2. **A UI for humans** - [Kiran Patil's Content Courier](https://sitecorebasics.wordpress.com/2026/07/08/introducing-content-courier-a-free-open-source-ui-for-moving-sitecoreai-content-goodbye-package-designer/),
   a free [open-source web app](https://github.com/klpatil/content-courier)
   that wraps the same APIs in a guided wizard.
3. **An interface for agents** - this repo. A skill is instructions + a script
   your AI agent uses on your behalf. One person can run several agent
   sessions in parallel, each moving different trees, while doing something
   else entirely.

All three build on the same public APIs. Use whichever interface fits the
moment - they are complementary, not competing.

## Skills

| Skill | What it does |
|---|---|
| [sitecore-content-transfer](skills/sitecore-content-transfer/SKILL.md) | Moves item trees (including page presentation) between two XM Cloud / SitecoreAI environments via the Content Transfer + Item Transfer APIs |

## Installation

### Claude Code

Copy the skill folder into your project (or your user profile for all
projects):

```bash
# per project
git clone https://github.com/harshbaid/sitecore-agent-skills
cp -r sitecore-agent-skills/skills/sitecore-content-transfer <your-project>/.claude/skills/

# or once, for every project
cp -r sitecore-agent-skills/skills/sitecore-content-transfer ~/.claude/skills/
```

Then just ask: *"copy /sitecore/content/MySite/Home from prod to dev"* -
Claude discovers the skill by its description and follows it.

### Cursor / other agents

Cursor does not execute Claude-style skills, but the skill file is plain
Markdown and the script is plain Node:

- Add a rule pointing at the skill, e.g. `.cursor/rules/sitecore-content-transfer.mdc`
  with: *"When asked to move Sitecore content between environments, follow
  `<path-to>/skills/sitecore-content-transfer/SKILL.md`."*
- Or paste `SKILL.md` into context and let the agent drive the script.

### No agent at all

The script stands alone:

```bash
node skills/sitecore-content-transfer/scripts/transfer.mjs \
  --source-host cm-source.sitecorecloud.io \
  --target-host cm-target.sitecorecloud.io \
  --path "/sitecore/content/MySite/Home"
```

## Prerequisites

- Node.js >= 20 (no npm installs - the script has zero dependencies)
- A SitecoreAI **organization** automation client (created by an Org
  Admin/Owner in Deploy > Credentials). See
  [.env.example](skills/sitecore-content-transfer/.env.example).

## Safety

- The automation client is **powerful** (org admin scope). Treat the secret
  like a production credential: `.env` files are git-ignored here, keep it
  that way.
- Transfers write to the target's **master** database only - publish on the
  target to see changes on the live site.
- The script refuses the `LatestWin` merge strategy: it is not implemented
  server-side and is known to crash CM environments.
- Test against non-production targets first.

## Contributing

Ideas queued up: publish-and-verify, Authoring GraphQL audits, serialized
content diffing. PRs and issues welcome - the bar for a skill is: a SKILL.md
an agent can follow cold, a zero-dependency script where one helps, and any
gotchas written down where the agent will find them.

## License

[MIT](LICENSE)
