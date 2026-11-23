// Downloadable deliverables for a scanned site: a WordPress plugin (.zip) that installs the
// on-site agent, and the site's knowledge base as Markdown or JSON.
import zlib from 'node:zlib';
import { llmsTxt } from './knowledge.js';

// ---------- minimal zip writer (deflate, no dependencies) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** files: [{ name: 'dir/file.php', data: string|Buffer }] → Buffer of a .zip archive */
export function zip(files) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const packed = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------- knowledge base ----------
export function knowledgeJson(site) {
  const m = site.manifest;
  return {
    schema: 'sitebridge-knowledge/1',
    generated_at: new Date().toISOString(),
    site: { name: m.name, url: site.origin, tagline: m.tagline, category: m.category, language: site.lang || null },
    summary: m.summary, audience: m.audience, key_facts: m.key_facts, contact: m.contact,
    offerings: m.offerings, faqs: m.faqs, tasks: m.tasks, important_pages: m.pages,
    pages: site.pages.map(p => ({ url: p.url, title: p.title, description: p.description || '', headings: p.headings || [], text: p.text })),
  };
}

export function knowledgeMarkdown(site) {
  const out = [llmsTxt(site).trim(), '', '---', '', '# Full page text', ''];
  for (const p of site.pages) {
    out.push(`## ${p.title || p.url}`, '', `Source: ${p.url}`, '');
    if (p.description) out.push(`> ${p.description}`, '');
    out.push(String(p.text || '').trim(), '');
  }
  return out.join('\n');
}

// ---------- WordPress plugin ----------
const phpStr = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const headerSafe = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\*\//g, '').slice(0, 120);

export const pluginSlug = site => `sitebridge-agent-${site.id}`.slice(0, 60);

export function wordpressPlugin(site, publicUrl) {
  const m = site.manifest;
  const slug = pluginSlug(site);
  const fn = 'sitebridge_' + site.id.replace(/[^a-z0-9]/gi, '_');
  const php = `<?php
/**
 * Plugin Name:       Site Bridge AI Agent (${headerSafe(m.name)})
 * Plugin URI:        ${publicUrl}
 * Description:       Adds the Site Bridge AI agent to every page: an "Ask AI" button that answers from your website's content and can move around your pages for the visitor. Works with any theme and page builder.
 * Version:           1.0.0
 * Requires at least: 5.0
 * Requires PHP:      7.0
 * Author:            Site Bridge
 * License:           GPL-2.0-or-later
 * Text Domain:       ${slug}
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( '${fn.toUpperCase()}_SERVER', '${phpStr(publicUrl)}' );
define( '${fn.toUpperCase()}_SITE', '${phpStr(site.id)}' );

/** Settings: on/off and an optional brand colour (Settings → Site Bridge Agent). */
function ${fn}_options() {
	return wp_parse_args( get_option( '${fn}', array() ), array( 'enabled' => 1, 'color' => '' ) );
}

add_action( 'wp_footer', function () {
	if ( is_admin() ) {
		return;
	}
	$o = ${fn}_options();
	if ( empty( $o['enabled'] ) ) {
		return;
	}
	$color = sanitize_hex_color( $o['color'] );
	printf(
		'<script src="%s" data-site="%s"%s defer></script>' . "\\n",
		esc_url( ${fn.toUpperCase()}_SERVER . '/widget.js' ),
		esc_attr( ${fn.toUpperCase()}_SITE ),
		$color ? ' data-color="' . esc_attr( $color ) . '"' : ''
	);
}, 99 );

add_action( 'admin_menu', function () {
	add_options_page( 'Site Bridge Agent', 'Site Bridge Agent', 'manage_options', '${slug}', '${fn}_settings_page' );
} );

add_action( 'admin_init', function () {
	register_setting( '${fn}', '${fn}', array(
		'sanitize_callback' => function ( $in ) {
			return array(
				'enabled' => empty( $in['enabled'] ) ? 0 : 1,
				'color'   => sanitize_hex_color( isset( $in['color'] ) ? $in['color'] : '' ) ?: '',
			);
		},
	) );
} );

function ${fn}_settings_page() {
	$o = ${fn}_options();
	?>
	<div class="wrap">
		<h1>Site Bridge AI Agent</h1>
		<p>The agent is built from <strong><?php echo esc_html( '${phpStr(site.origin)}' ); ?></strong>. It answers from your site's content and can open pages, scroll and point things out for your visitors.</p>
		<form method="post" action="options.php">
			<?php settings_fields( '${fn}' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">Show the agent</th>
					<td><label><input type="checkbox" name="${fn}[enabled]" value="1" <?php checked( $o['enabled'], 1 ); ?>> Show the "Ask AI" button on every page</label></td>
				</tr>
				<tr>
					<th scope="row"><label for="${fn}-color">Brand colour</label></th>
					<td><input type="text" id="${fn}-color" name="${fn}[color]" value="<?php echo esc_attr( $o['color'] ); ?>" placeholder="#2238f5" class="regular-text">
					<p class="description">Optional. Leave empty to use your site's own colour automatically.</p></td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
		<p>The full knowledge base the agent uses is included in this plugin as <code>knowledge.md</code>.</p>
	</div>
	<?php
}

add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
	array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=${slug}' ) ) . '">Settings</a>' );
	return $links;
} );
`;
  const readme = `=== Site Bridge AI Agent (${headerSafe(m.name)}) ===
Contributors: sitebridge
Tags: ai, chatbot, assistant, agent, support
Requires at least: 5.0
Tested up to: 6.7
Stable tag: 1.0.0
License: GPLv2 or later

An AI agent for ${headerSafe(m.name)} that answers from your website and guides visitors around it.

== Installation ==

1. In WordPress, go to Plugins → Add New → Upload Plugin.
2. Choose this .zip file and click Install Now, then Activate.
3. Visit your site: an "Ask AI" button appears on every page.

Optional: Settings → Site Bridge Agent to turn it off or set a brand colour.

== Notes ==

The agent runs on ${publicUrl}. Your website must be able to reach it; no other setup is needed.
`;
  return zip([
    { name: `${slug}/${slug}.php`, data: php },
    { name: `${slug}/readme.txt`, data: readme },
    { name: `${slug}/knowledge.md`, data: knowledgeMarkdown(site) },
  ]);
}
