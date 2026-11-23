// Minimal MCP server (JSON-RPC 2.0 over Streamable HTTP, stateless) generated per site.
import { searchSite, getPage, overview, uniqueForms } from './knowledge.js';

const SUPPORTED = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];

/** One tool per site. No arguments: the full site profile (facts, contact, pages, offerings,
 *  FAQs, visitor tasks, forms). `query`: search every page. `page`: one page's full text. */
export function buildTools(site) {
  const m = site.manifest;
  const forms = () => uniqueForms(site).slice(0, 8).map(f => ({ page: f.page, heading: f.heading || null, method: f.method, fields: f.fields, submit_button: f.submit }));
  return [{
    name: 'site_knowledge',
    description: `Everything about ${m.name} (${site.hostname}), answered from its public website. ` +
      'Call with no arguments for the site profile: summary, key facts, contact details, important pages, offerings, FAQs, ' +
      'visitor tasks with steps, and forms. Pass "query" to search every page for relevant passages with source URLs. ' +
      'Pass "page" (a URL or path such as "/pricing") for the full text, headings and forms.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for on the site' },
        page: { type: 'string', description: 'Absolute URL or path of one page on this site' },
        limit: { type: 'number', description: 'Max search results (default 5, max 10)' },
      },
      required: [],
    },
    run: (a = {}, index) => {
      if (a.page) return getPage(site, a.page);
      if (a.query) return searchSite(site, index, a.query, a.limit);
      return {
        ...overview(site),
        contact: m.contact,
        pages: m.pages,
        offerings: m.offerings,
        faqs: m.faqs,
        tasks: m.tasks.map(t => ({ task: t.name, description: t.description || '', start_url: t.start_url, steps: t.steps })),
        forms: forms(),
      };
    },
  }];
}

export function publicTools(site) {
  return buildTools(site).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** Handles one JSON-RPC message or batch. Returns null when there is nothing to send back (notifications). */
export function handleMcp(site, index, body) {
  const tools = buildTools(site);
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  const one = msg => {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid Request');
    const { id, method, params = {} } = msg;
    if (id === undefined || id === null) return null; // notification, e.g. notifications/initialized
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: `sitebridge-${site.id}`, title: `${site.manifest.name} (Site Bridge)`, version: '0.1.0' },
          instructions: `Tools for ${site.manifest.name} (${site.origin}). ${site.manifest.summary || ''}`.trim(),
        });
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const tool = tools.find(t => t.name === params.name);
        if (!tool) return ok(id, { content: [{ type: 'text', text: `Unknown tool: ${params.name}` }], isError: true });
        try {
          const result = tool.run(params.arguments || {}, index);
          return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: Boolean(result?.error) });
        } catch (e) {
          return ok(id, { content: [{ type: 'text', text: `Tool failed: ${e.message}` }], isError: true });
        }
      }
      case 'resources/list': return ok(id, { resources: [] });
      case 'prompts/list': return ok(id, { prompts: [] });
      default:
        return fail(id, -32601, `Method not found: ${method}`);
    }
  };

  if (Array.isArray(body)) {
    const out = body.map(one).filter(Boolean);
    return out.length ? out : null;
  }
  return one(body);
}
