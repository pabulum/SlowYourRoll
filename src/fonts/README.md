# Fonts

Self-hosted rather than pulled from a CDN: the app's only third-party request stays Wowhead's
tooltip widget, and the type doesn't change if a font host is blocked or slow.

| File | Family | Axes | Role |
| --- | --- | --- | --- |
| `inter-latin.woff2`, `inter-latin-ext.woff2` | [Inter](https://rsms.me/inter/) | `opsz` 14–32, `wght` 100–900 | `--font-ui` — everything readable |
| `space-grotesk-latin.woff2`, `space-grotesk-latin-ext.woff2` | [Space Grotesk](https://floriankarsten.github.io/space-grotesk/) | `wght` 300–700 | `--font-display` — type ≥19px only |

Both are variable fonts, so the whole weight range costs one file per subset. Latin-ext is a
separate `@font-face` with its own `unicode-range`; it only downloads when an accented character
appears — realm and character names being the usual reason.

The subsets are Google Fonts' builds (`fonts.gstatic.com`), which is why the `unicode-range`
declarations in `../styles.css` match theirs exactly. To refresh, re-request the CSS with a
browser user-agent and pull the `latin` / `latin-ext` `woff2` URLs out of it.

Both families are licensed under the SIL Open Font License 1.1 — see `inter-OFL.txt` and
`space-grotesk-OFL.txt`. Neither is affiliated with this project.
