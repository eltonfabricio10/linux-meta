# Package Metadata Rules

Purpose: metadata for software-center UIs such as Pamac.

Use with `AGENTS.md`. Keep this file current and short.

## Field Roles

`en.summary`

- Official package-manager metadata.
- Preserve `package_official_metadata.official_summary`.
- Do not rewrite for style.
- Change only when source identity is demonstrably wrong.

`package.name`

- Immutable source identity.
- Use as context for understanding the package.
- Never rewrite during review.

`pt-br.summary`

- Faithful short translation of `en.summary`.
- No final period.
- No invented benefit.
- Usually a noun phrase.

`description`

- Main quality field.
- EN and PT-BR must be semantically equivalent.
- Write for normal users, not package maintainers.
- Help the user decide whether to install.
- First sentence must earn attention: start with the concrete job, visible
  result, or capability.
- Do not start with package name or obvious mechanics: opens, launches, starts,
  runs, shows, installs, adds, provides access, keeps ready, or PT-BR
  equivalents.
- Treat "opens/launches/starts/runs/shows/installs/adds + app name" as invalid,
  even for GUI apps.
- Do not write "opens [app]" / "abre o [app]". Opening is obvious and not a
  benefit. Start with what the user can make, manage, view, protect, connect,
  automate, or fix.
- If a draft starts by saying the program opens, rewrite from the user's goal.
  The lead must say what the package helps the person accomplish after it is
  open, not the fact that it opens.
- Do not use launcher behavior as value. Store "how to start it" only in
  `launch_*` profile fields.
- Bad: "Opens Pure Data..." / "Abre o Pure Data...".
- Better: "Build real-time audio and visual patches without writing
  traditional code...".
- Do not spend first sentence on obvious install/open/run/show/add behavior.
- Use two short paragraphs by default.
- Use bullets only when several concrete capabilities become easier to scan.

`plain_explanation`

- Keep NULL by default.
- Do not create a second explanation that repeats summary/description.
- Fill only if product UI later gives it a distinct purpose.

## Description Harness

Answer the user's real questions:

1. What is it?
2. What can I do with it, or what does it enable?
3. Is it an app, CLI tool, service, library, theme, data pack, plugin, driver,
   docs, compatibility layer, or metapackage?
4. Do I open it, run a command, configure it, or get it only as dependency?
5. Who needs it?
6. What changes after install?
7. What can go wrong or require care?

Preferred structure:

```text
[Concrete job/value] + [plain role].

[How user interacts / who needs it / visible effect / caution].
```

Good dependency/data pattern:

```text
Contains files needed by [app/component] to [specific effect]. These files are
used by [app/component], but they are not [common confusion].

Most users need this only together with [app/component]. It does not appear as a
separate app; install it when [app/component] requires it.
```

Avoid vague phrases:

- "support files"
- "resources"
- "runtime behavior"
- "provides data assets"
- "needed by software"

If those words are unavoidable, explain what they mean for the user.

## Type Guidance

Library:

- First sentence: practical capability.
- Second paragraph: usually consumed by apps/developers; not opened directly.

CLI:

- Say it runs from terminal.
- Name the concrete task.
- Warn if it changes files, devices, services, containers, credentials, or
  network state.

GUI app:

- Say what the user sees/does.
- Do not put launch command in prose unless needed for clarity.
- Do not write "opens [app name]"; the user already knows apps open.
- Do not use "abre/inicia/executa/mostra/instala/adiciona" or
  "launches/opens/runs/shows/installs/adds [app name]" as the lead. Start with
  the task, document, media, setting, or workflow the screen helps with.
- Prefer the user task: "Edit PDFs by...", "Build audio patches by...",
  "Manage photos with...".

Service/daemon:

- Say it runs in background.
- Say what ongoing job it performs.
- Say who configures/monitors it.

Theme/font/icon/wallpaper/sound/language/data:

- Say it is content/support data.
- Say visible effect.
- Do not describe as an app.

Category notes:

- Plymouth themes: `fonts-themes/boot-themes`, not GTK.
- Window-manager themes: `fonts-themes/window-manager-themes`, not GTK.
- Sound themes: `fonts-themes/sound-themes`.
- Wallpapers/background packs: `fonts-themes/wallpapers`.
- Fcitx/IBus/IME packages: `localization/input-methods`.
- COSMIC/i3 desktop packages: `desktop/cosmic` or `desktop/i3`.
- Servers/cloud sync clients: `internet/servers` or `internet/cloud-sync`.
- Developer utilities that are not compilers/editors/VCS: `development/tools`.
- Terminals and file managers: `apps/terminals` or `apps/file-management`.
- Debuggers/profilers/package helpers: `development/debugging` or
  `development/package-tools`.
- Containers/VMs/emulators: `virtualization/*`.
- Database servers/clients: `databases/*`.
- Security/storage/networking/monitoring/printing/hardware/accessibility:
  `system/*`.
- Codecs and non-app plugins: `runtime-libs/codecs` or `runtime-libs/plugins`.

Metapackage:

- Say it groups dependencies.
- Explain bundle purpose.
- Do not imply standalone behavior.

Compatibility package:

- Say what stacks/protocols/commands it bridges.
- Say when compatibility is useful.

Security/system/network:

- Mention relevant caution: permissions, firewall, credentials, public network,
  destructive writes, boot, hardware, privacy, online content, public chat, or
  offensive security.

## Hard Rejects

Rewrite if any appears:

- Starts with package name plus "provides/is/contains/fornece/é/contém".
- Starts with obvious mechanics instead of user value: open, run, show, install,
  add, provide access, keep ready, or PT-BR equivalents.
- Repeats summary with more words.
- Generic repo/upstream/license/provenance filler.
- "Install it when this capability is needed directly or as a dependency..."
- "Use this package when you need..."
- "Instale este pacote quando precisar..."
- Untranslated English in PT-BR when natural Portuguese exists.
- ASCII-only Portuguese common words: `configuracao`, `documentacao`,
  `informacoes`, `execucao`, `aplicacao`, `funcao`, `autenticacao`,
  `comunicacao`, `codigo`, `memoria`, `usuario`.
- Marketing claims: best, leading, powerful, easy, modern, unless part of an
  official name or needed technical distinction.
- Describes a data/theme/font package as executable software.

## Profile Fields

`package_profile` stores one current profile per package.

- `component_type`: package kind. Examples: `desktop-application`, `app`,
  `service`, `library`, `driver`, `kernel-module`, `firmware`, `font`, `theme`,
  `icon-theme`, `plugin`, `addon`, `codec`, `input-method`, `localization`,
  `documentation`, `data`, `game`, `build-tool`, `runtime`, `metapackage`,
  `compatibility`.
- `interface_kinds`: user interaction modes. Examples: `gui`, `cli`, `tui`,
  `web`, `server`, `desktop`, `system`, `development`, `audio`, `video`,
  `graphics`, `network`, `database`, `security`, `hardware`, `docs`.
- `audience_tags`: likely audience. Examples: `end-user`, `developer`,
  `administrator`, `creator`, `gamer`, `translator`, `researcher`, `student`,
  `kde-user`, `gnome-user`.
- `launchable`: true when user can directly start it.
- `launch_kind`: `desktop-id`, `command`, `flatpak-id`, `service`, `url`, or
  `none`.
- `launch_id`: desktop id, Flatpak id, systemd unit, URL, or source id.
- `launch_command`: probable user-facing command.
- `launch_source`: `desktop_file`, `flatpak_manifest`, `appstream`,
  `pkg_binary`, `manual_review`, `heuristic`, `codex`, or `unknown`.
- `launch_confidence`: `official`, `detected`, `probable`, `unknown`, `high`,
  `medium`, `low`, or `none`.
- `keywords`: useful search terms.
- `requires_terminal`: terminal-bound launcher.
- `is_background_service`: background service.
- `is_dependency_only`: not normally chosen directly by users.

## Screenshot Support

- Optional future admin metadata.
- Review workflow does not generate screenshots.
- Show only reviewed/approved screenshots when moderation exists.
