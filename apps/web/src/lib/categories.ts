/**
 * Package taxonomy: 2-level (category > subcategory) with deterministic matching
 * rules derived from real DB signals (debian sections, manjaro GROUPS, flathub
 * `kind`, and conservative name regexes for AUR / fallback).
 *
 * Strategy: a package may appear in MULTIPLE subcategories (one per matching
 * rule across distinct categories) — this gives users the most useful index
 * (e.g. `kdenlive` shows in apps/video AND desktop/kde). Within a single
 * category, the first matching subcategory wins (no duplicates in one column).
 * If nothing matches, the package falls into `other/uncategorized`.
 *
 * Counts + listing queries hit Postgres directly through Drizzle's `sql`
 * template tag; we generate one big `CASE` chain server-side. Counts memoized
 * for 5 minutes at module scope.
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from './db';

export type MatchRules = {
  /** debian `Section:` field, case-insensitive exact match */
  sections?: string[];
  /** manjaro `GROUPS` array element, case-insensitive exact match */
  groups?: string[];
  /** manjaro `repo` (extra/core/community/multilib) exact match */
  repos?: string[];
  /** flathub `kind` exact match */
  flathubKinds?: string[];
  /** name regex (any-source fallback, mostly for AUR + naming convention) */
  nameRegex?: RegExp[];
};

import { defaultLocale, type Locale } from '~/i18n/config';

export type Subcategory = {
  slug: string;
  labels: Partial<Record<Locale, string>>;
  match: MatchRules;
};

export type Category = {
  slug: string;
  labels: Partial<Record<Locale, string>>;
  subcategories: Subcategory[];
};

/** Helper to build name regexes once (anchored, case-insensitive). */
const re = (...parts: string[]): RegExp[] => parts.map((p) => new RegExp(p, 'i'));

export const taxonomy: Category[] = [
  {
    slug: 'apps',
    labels: { en: 'Apps', pt: 'Aplicativos' },
    subcategories: [
      {
        slug: 'audio',
        labels: { en: 'Audio', pt: 'Áudio' },
        match: {
          sections: ['sound'],
          groups: [
            'pro-audio', 'lv2-plugins', 'vst-plugins', 'vst3-plugins',
            'clap-plugins', 'ladspa-plugins', 'dssi-plugins',
            'gst-plugins-rs', 'rhvoice', 'soundfonts', 'vamp-plugins',
            'pd-externals', 'feeluown-full', 'kde-multimedia',
          ],
          nameRegex: re('^audacity', '^ardour', '^rosegarden', '-audio($|-)'),
        },
      },
      {
        slug: 'video',
        labels: { en: 'Video', pt: 'Vídeo' },
        match: {
          groups: ['kodi-addons', 'kodi-addons-screensaver', 'kodi-addons-visualization', 'kodi-addons-audioencoder', 'kodi-addons-inputstream', 'kodi-addons-imagedecoder', 'kodi-addons-peripheral', 'libretro'],
          nameRegex: re('^kdenlive', '^obs-', '^mpv', '^vlc', '^kodi', '-video($|-)'),
        },
      },
      {
        slug: 'graphics',
        labels: { en: 'Graphics', pt: 'Gráficos' },
        match: {
          sections: ['graphics'],
          groups: ['kde-graphics'],
          nameRegex: re('^gimp', '^inkscape', '^krita', '^blender', '^darktable'),
        },
      },
      {
        slug: 'office',
        labels: { en: 'Office', pt: 'Escritório' },
        match: {
          groups: ['kde-office'],
          nameRegex: re('^libreoffice', '^calligra', '^onlyoffice', '^abiword', '^gnumeric'),
        },
      },
      {
        slug: 'internet',
        labels: { en: 'Internet', pt: 'Internet' },
        match: {
          sections: ['net', 'web', 'httpd'],
          nameRegex: re('^firefox($|-)', '^chromium($|-)', '^thunderbird', '^transmission', '^qbittorrent', '^filezilla'),
        },
      },
      {
        slug: 'communication',
        labels: { en: 'Communication', pt: 'Comunicação' },
        match: {
          sections: ['comm', 'mail', 'hamradio'],
          groups: ['kde-network', 'fcitx5-im', 'jami'],
          nameRegex: re('^telegram', '^signal-', '^discord', '^element', '^pidgin', '^hexchat', '^weechat'),
        },
      },
      {
        slug: 'education',
        labels: { en: 'Education', pt: 'Educação' },
        match: {
          groups: ['kde-education', 'sugar-fructose'],
          nameRegex: re('^gcompris', '^stellarium', '^kgeography', '^kalzium'),
        },
      },
      {
        slug: 'science',
        labels: { en: 'Science', pt: 'Ciência' },
        match: {
          sections: ['science', 'math', 'electronics'],
          groups: ['coin-or'],
          nameRegex: re('^octave', '^scilab', '^maxima', '^gnuplot'),
        },
      },
      {
        slug: 'finance',
        labels: { en: 'Finance', pt: 'Finanças' },
        match: {
          nameRegex: re('^gnucash', '^homebank', '^kmymoney', '-finance($|-)'),
        },
      },
      {
        slug: 'games',
        labels: { en: 'Games', pt: 'Jogos' },
        match: {
          sections: ['games'],
          groups: ['kde-games'],
          nameRegex: re('-game($|s$)', '^steam($|-)', '^lutris', '^wine($|-)', '^proton($|-)'),
        },
      },
      {
        slug: 'terminals',
        labels: { en: 'Terminals', pt: 'Terminais' },
        match: {
          nameRegex: re('terminal', '^konsole$', '^gnome-terminal$', '^xterm$', '^alacritty$', '^kitty$', '^wezterm$', '^tmux$', '^screen$'),
        },
      },
      {
        slug: 'file-management',
        labels: { en: 'File management', pt: 'Gerenciamento de arquivos' },
        match: {
          nameRegex: re('file-manager', '^dolphin$', '^nautilus$', '^thunar$', '^nemo$', '^pcmanfm', '^ark$', '^file-roller$', '^engrampa$', 'archive'),
        },
      },
      {
        slug: 'utilities',
        labels: { en: 'Utilities', pt: 'Utilitários' },
        match: {
          sections: ['utils', 'text', 'misc'],
          groups: ['kde-utilities', 'maui', 'x-apps'],
          flathubKinds: ['desktop-application', 'console-application', 'desktop'],
        },
      },
    ],
  },
  {
    slug: 'development',
    labels: { en: 'Development', pt: 'Desenvolvimento' },
    subcategories: [
      {
        slug: 'languages',
        labels: { en: 'Languages', pt: 'Linguagens' },
        match: {
          sections: ['python', 'java', 'lisp', 'javascript'],
          groups: ['dlang', 'dlang-dmd', 'dlang-ldc', 'mingw-w64', 'mingw-w64-toolchain', 'pyqt6', 'pyqt5', 'python-build-backend', 'gambas3'],
          nameRegex: re('^python-', '^python3-', '^haskell-', '^perl-', '^ruby-', '^rust-', '^golang-', '^ghc-', '^lua-'),
        },
      },
      {
        slug: 'libraries',
        labels: { en: 'Libraries', pt: 'Bibliotecas' },
        match: {
          sections: ['libdevel', 'introspection'],
          groups: ['vulkan-devel'],
          nameRegex: re('-devel($|-)', '-headers$', '-dev$'),
        },
      },
      {
        slug: 'build-tools',
        labels: { en: 'Build tools', pt: 'Ferramentas de build' },
        match: {
          sections: ['devel'],
          groups: ['archlinux-tools', 'manjaro-tools', 'reproducible-faketools'],
          nameRegex: re('^cmake', '^meson', '^ninja', '^autoconf', '^automake', '^gcc', '^clang', '^llvm'),
        },
      },
      {
        slug: 'debugging',
        labels: { en: 'Debugging & profiling', pt: 'Depuração e profiling' },
        match: {
          nameRegex: re('^gdb($|-)', '^lldb($|-)', '^strace$', '^ltrace$', '^valgrind', '^perf$', 'debugger', 'profiler', 'flamegraph', 'coverage'),
        },
      },
      {
        slug: 'package-tools',
        labels: { en: 'Package tools', pt: 'Ferramentas de pacotes' },
        match: {
          groups: ['alpm'],
          nameRegex: re('^pacman($|-)', '^makepkg', '^namcap$', '^paru$', '^yay$', '^pamac', '^aurutils', 'pkgbuild', 'package.*tool'),
        },
      },
      {
        slug: 'tools',
        labels: { en: 'Developer tools', pt: 'Ferramentas de desenvolvimento' },
        match: {
          nameRegex: re('^gdb($|-)', '^jupyter', '^kcachegrind', '^kompare', '^geckodriver', '^godot($|-)'),
        },
      },
      {
        slug: 'editors',
        labels: { en: 'Editors', pt: 'Editores' },
        match: {
          sections: ['editors'],
          groups: ['vim-plugins', 'neovim-plugins', 'tree-sitter-grammars', 'kdevelop'],
          nameRegex: re('^vim($|-)', '^neovim', '^emacs', '^code$', '^vscodium', '^geany', '^kate$'),
        },
      },
      {
        slug: 'vcs',
        labels: { en: 'Version control', pt: 'Controle de versão' },
        match: {
          nameRegex: re('^git($|-)', '^mercurial', '^subversion', '^breezy', '^fossil'),
        },
      },
    ],
  },
  {
    slug: 'system',
    labels: { en: 'System', pt: 'Sistema' },
    subcategories: [
      {
        slug: 'kernel',
        labels: { en: 'Kernel', pt: 'Kernel' },
        match: {
          groups: [
            'linux61-extramodules', 'linux612-extramodules', 'linux618-extramodules',
            'linux66-extramodules', 'linux617-rt-extramodules', 'linux612-rt-extramodules',
            'linux61-rt-extramodules', 'linux66-rt-extramodules', 'linux70-extramodules',
            'linux71-extramodules', 'linux-tools', 'realtime', 'dracut-modules',
          ],
          nameRegex: re('^linux($|-)', '^kernel-'),
        },
      },
      {
        slug: 'drivers',
        labels: { en: 'Drivers', pt: 'Drivers' },
        match: {
          groups: ['xorg-drivers', 'fprint'],
          nameRegex: re('^xf86-', '^nvidia-', '^amdgpu-', '-driver($|s$)', '^firmware-'),
        },
      },
      {
        slug: 'hardware',
        labels: { en: 'Hardware', pt: 'Hardware' },
        match: {
          groups: ['arduino'],
          nameRegex: re('bluetooth', '^bluez', '^fwupd', '^upower', 'battery', 'sensor', '^lm_sensors', '^usbutils', '^pciutils', '^hwinfo'),
        },
      },
      {
        slug: 'networking',
        labels: { en: 'Networking', pt: 'Rede' },
        match: {
          nameRegex: re('^networkmanager', '^netctl', '^iw$', '^iwd$', '^wireless', '^vpn', 'openvpn', 'wireguard', '^nftables', '^iptables'),
        },
      },
      {
        slug: 'storage',
        labels: { en: 'Storage & backup', pt: 'Armazenamento e backup' },
        match: {
          nameRegex: re('filesystem', '^btrfs', '^xfs', '^zfs', '^ntfs', '^exfat', '^gparted$', 'partition', 'backup', 'snapshot', '^rsync$', '^borg', '^restic'),
        },
      },
      {
        slug: 'monitoring',
        labels: { en: 'Monitoring & diagnostics', pt: 'Monitoramento e diagnóstico' },
        match: {
          nameRegex: re('monitor', 'diagnostic', '^htop$', '^btop$', '^iotop$', '^iftop$', '^glances$', '^smartmontools$', '^sysstat$', '^logrotate$'),
        },
      },
      {
        slug: 'security',
        labels: { en: 'Security', pt: 'Segurança' },
        match: {
          nameRegex: re('firewall', 'crypt', '^gnupg', '^gpg', '^openssl', '^keepass', '^pass$', 'password', 'keyring', 'authenticator', 'hashcat', '^john$', 'forensic', 'audit'),
        },
      },
      {
        slug: 'printing-scanning',
        labels: { en: 'Printing & scanning', pt: 'Impressão e digitalização' },
        match: {
          nameRegex: re('^cups', '^sane', 'scanner', 'printer', 'printing', 'hplip'),
        },
      },
      {
        slug: 'accessibility',
        labels: { en: 'Accessibility', pt: 'Acessibilidade' },
        match: {
          nameRegex: re('accessibility', '^orca$', 'screen-reader', 'magnifier', 'speech', 'tts', 'braille', '^espeak', '^festival'),
        },
      },
      {
        slug: 'daemons',
        labels: { en: 'Daemons', pt: 'Daemons' },
        match: {
          groups: ['syslog-ng-modules'],
          nameRegex: re('-daemon($|-)', '-server$', '^systemd-'),
        },
      },
      {
        slug: 'admin',
        labels: { en: 'Administration', pt: 'Administração' },
        match: {
          sections: ['admin'],
          groups: ['kde-system', 'kubernetes-tools', 'kubernetes-control-plane', 'kubernetes-node', 'kubectl-plugins', 'maelstrom-cluster', 'alpm', 'coreboot-utils', 'arduino'],
        },
      },
      {
        slug: 'init',
        labels: { en: 'Init & boot', pt: 'Init e boot' },
        match: {
          nameRegex: re('^grub($|-)', '^syslinux', '^systemd$', '^openrc', '^runit', '^dinit'),
        },
      },
    ],
  },
  {
    slug: 'networking',
    labels: { en: 'Networking', pt: 'Rede' },
    subcategories: [
      {
        slug: 'protocols',
        labels: { en: 'Protocols & stacks', pt: 'Protocolos e pilhas' },
        match: {
          nameRegex: re('^libnghttp', '^libngtcp', '^libnl$', '^libpsl$', '^libssh2$', '^libtirpc$', '^nfsidmap$', '^nghttp', '^quic'),
        },
      },
      {
        slug: 'diagnostics',
        labels: { en: 'Diagnostics', pt: 'Diagnóstico' },
        match: {
          nameRegex: re('^libpcap$', '^tcpdump$', '^wireshark', '^traceroute$', '^mtr$', '^nmap$', '^iperf'),
        },
      },
      {
        slug: 'directory-services',
        labels: { en: 'Directory services', pt: 'Serviços de diretório' },
        match: {
          nameRegex: re('^openldap$', '^ldap', '^libldap', '^libnsl$', '^nss-pam-ldapd'),
        },
      },
      {
        slug: 'vpn',
        labels: { en: 'VPN & tunnels', pt: 'VPN e túneis' },
        match: {
          nameRegex: re('openvpn', 'wireguard', '^pptp', '^ppp$', 'vpn', 'tunnel'),
        },
      },
    ],
  },
  {
    slug: 'security',
    labels: { en: 'Security', pt: 'Segurança' },
    subcategories: [
      {
        slug: 'cryptography',
        labels: { en: 'Cryptography', pt: 'Criptografia' },
        match: {
          nameRegex: re('crypt', '^openssl$', '^gnutls', '^nettle$', '^nss$', '^p11-kit', '^libp11-kit', '^libgcrypt', '^libksba', '^libtasn1', '^libxcrypt'),
        },
      },
      {
        slug: 'authentication',
        labels: { en: 'Authentication', pt: 'Autenticação' },
        match: {
          nameRegex: re('^pam$', '^pambase$', '^pinentry$', '^libsasl$', 'login', 'auth'),
        },
      },
      {
        slug: 'credential-storage',
        labels: { en: 'Credential storage', pt: 'Armazenamento de credenciais' },
        match: {
          nameRegex: re('^libsecret', 'keyring', 'secret-service', 'credential'),
        },
      },
      {
        slug: 'sandboxing',
        labels: { en: 'Sandboxing', pt: 'Sandboxing' },
        match: {
          nameRegex: re('^libseccomp$', 'sandbox', 'bubblewrap', '^firejail$'),
        },
      },
      {
        slug: 'auditing',
        labels: { en: 'Auditing', pt: 'Auditoria' },
        match: {
          nameRegex: re('audit', 'compliance', 'forensic'),
        },
      },
    ],
  },
  {
    slug: 'desktop',
    labels: { en: 'Desktop', pt: 'Desktop' },
    subcategories: [
      {
        slug: 'portals',
        labels: { en: 'Desktop portals', pt: 'Portais de desktop' },
        match: {
          nameRegex: re('^xdg-desktop-portal'),
        },
      },
      {
        slug: 'display-managers',
        labels: { en: 'Display managers', pt: 'Gerenciadores de login' },
        match: {
          nameRegex: re('^sddm', '^gdm$', '^lightdm', '^ly$', 'display-manager', 'greeter'),
        },
      },
      {
        slug: 'kde',
        labels: { en: 'KDE', pt: 'KDE' },
        match: {
          sections: ['kde'],
          groups: [
            'kf6', 'kf5', 'plasma', 'kde-applications', 'kde-pim',
            'kde-accessibility', 'kde-sdk', 'kde-network', 'kde-utilities',
            'kde-multimedia', 'kde-graphics', 'kde-games', 'kde-education',
            'kde-system', 'kde-office', 'qt6', 'qt5',
          ],
          nameRegex: re('^k(de|f)-', '^plasma-', '^kio-'),
        },
      },
      {
        slug: 'gnome',
        labels: { en: 'GNOME', pt: 'GNOME' },
        match: {
          sections: ['gnome'],
          groups: ['gnome', 'gnome-circle', 'gnome-extra', 'gnustep-core'],
          nameRegex: re('^gnome-', '^gtk[34]-'),
        },
      },
      {
        slug: 'xfce',
        labels: { en: 'Xfce', pt: 'Xfce' },
        match: {
          groups: ['xfce4', 'xfce4-goodies'],
          nameRegex: re('^xfce4-', '^xfwm'),
        },
      },
      {
        slug: 'lxqt',
        labels: { en: 'LXQt', pt: 'LXQt' },
        match: {
          groups: ['lxqt', 'lxde'],
          nameRegex: re('^lxqt-', '^lxde-'),
        },
      },
      {
        slug: 'mate',
        labels: { en: 'MATE', pt: 'MATE' },
        match: {
          groups: ['mate', 'mate-extra'],
          nameRegex: re('^mate-'),
        },
      },
      {
        slug: 'deepin',
        labels: { en: 'Deepin', pt: 'Deepin' },
        match: {
          groups: ['deepin', 'deepin-extra'],
          nameRegex: re('^deepin-'),
        },
      },
      {
        slug: 'pantheon',
        labels: { en: 'Pantheon', pt: 'Pantheon' },
        match: {
          groups: ['pantheon'],
          nameRegex: re('^pantheon-', '^elementary-'),
        },
      },
      {
        slug: 'cinnamon',
        labels: { en: 'Cinnamon', pt: 'Cinnamon' },
        match: {
          nameRegex: re('^cinnamon($|-)', '^nemo($|-)'),
        },
      },
      {
        slug: 'budgie',
        labels: { en: 'Budgie', pt: 'Budgie' },
        match: {
          groups: ['budgie'],
          nameRegex: re('^budgie-'),
        },
      },
      {
        slug: 'cosmic',
        labels: { en: 'COSMIC', pt: 'COSMIC' },
        match: {
          nameRegex: re('^cosmic-'),
        },
      },
      {
        slug: 'i3',
        labels: { en: 'i3', pt: 'i3' },
        match: {
          nameRegex: re('^i3($|-)', '^i3blocks$', '^i3status', '^manjaro-i3-', '^pekwm$'),
        },
      },
      {
        slug: 'hyprland',
        labels: { en: 'Hyprland', pt: 'Hyprland' },
        match: {
          nameRegex: re('^hyprland($|-)', '^hypr[a-z]+'),
        },
      },
      {
        slug: 'window-managers',
        labels: { en: 'Window managers', pt: 'Gerenciadores de janelas' },
        match: {
          nameRegex: re('^sway($|-)', '^openbox($|-)', '^awesome($|-)', '^qtile($|-)', '^xmonad($|-)', '^wayfire($|-)', '^fluxbox($|-)', '^wmii($|-)'),
        },
      },
    ],
  },
  {
    slug: 'fonts-themes',
    labels: { en: 'Fonts & themes', pt: 'Fontes e temas' },
    subcategories: [
      {
        slug: 'fonts',
        labels: { en: 'Fonts', pt: 'Fontes' },
        match: {
          groups: ['nerd-fonts', 'ipa-fonts', 'xorg-fonts'],
          nameRegex: re('^ttf-', '^otf-', '^font-', '-fonts?($|-)', '^noto-'),
        },
      },
      {
        slug: 'icon-themes',
        labels: { en: 'Icon themes', pt: 'Temas de ícones' },
        match: {
          nameRegex: re('-icon-theme($|-)', '^icon-theme-'),
        },
      },
      {
        slug: 'boot-themes',
        labels: { en: 'Boot themes', pt: 'Temas de inicialização' },
        match: {
          nameRegex: re('^plymouth-theme-', 'plymouth.*theme', 'theme.*plymouth'),
        },
      },
      {
        slug: 'sound-themes',
        labels: { en: 'Sound themes', pt: 'Temas de sons' },
        match: {
          nameRegex: re('^sound-theme-', '-sound-theme($|-)', 'sound-theme'),
        },
      },
      {
        slug: 'window-manager-themes',
        labels: { en: 'Window manager themes', pt: 'Temas de gerenciadores de janelas' },
        match: {
          nameRegex: re('^pekwm-themes?$', '^openbox.*themes?$', '^fluxbox.*themes?$', 'window-manager.*themes?'),
        },
      },
      {
        slug: 'wallpapers',
        labels: { en: 'Wallpapers', pt: 'Papéis de parede' },
        match: {
          nameRegex: re('wallpapers?($|-)', 'backgrounds?($|-)'),
        },
      },
      {
        slug: 'gtk-themes',
        labels: { en: 'GTK & Qt themes', pt: 'Temas GTK e Qt' },
        match: {
          nameRegex: re('-theme($|-)', '^gtk-theme-', '^qt-theme-'),
        },
      },
      {
        slug: 'cursors',
        labels: { en: 'Cursors', pt: 'Cursores' },
        match: {
          nameRegex: re('-cursor-theme($|-)', '-cursors$'),
        },
      },
    ],
  },
  {
    slug: 'documentation',
    labels: { en: 'Documentation', pt: 'Documentação' },
    subcategories: [
      {
        slug: 'api-docs',
        labels: { en: 'API documentation', pt: 'Documentação de API' },
        match: {
          nameRegex: re('-api-docs?$', '-apidocs?$', 'api-reference'),
        },
      },
      {
        slug: 'docs',
        labels: { en: 'Documentation', pt: 'Documentação' },
        match: {
          sections: ['doc'],
          nameRegex: re('-docs?$', '-documentation$'),
        },
      },
      {
        slug: 'manuals',
        labels: { en: 'Manuals', pt: 'Manuais' },
        match: {
          nameRegex: re('-manual$', '-man$', '^man-'),
        },
      },
      {
        slug: 'examples',
        labels: { en: 'Examples', pt: 'Exemplos' },
        match: {
          nameRegex: re('-examples?$', '-samples?$'),
        },
      },
    ],
  },
  {
    slug: 'localization',
    labels: { en: 'Localization', pt: 'Localização' },
    subcategories: [
      {
        slug: 'language-packs',
        labels: { en: 'Language packs', pt: 'Pacotes de idioma' },
        match: {
          groups: ['texlive-lang'],
          flathubKinds: ['localization'],
          nameRegex: re('-l10n($|-)', '-lang($|-)', '-locale($|-)', '-i18n($|-)', '-langpack($|-)'),
        },
      },
      {
        slug: 'dictionaries',
        labels: { en: 'Dictionaries', pt: 'Dicionários' },
        match: {
          groups: ['tesseract-data'],
          nameRegex: re('^hunspell-', '^aspell-', '^myspell-', '-dict($|-)', '-dictionary$'),
        },
      },
      {
        slug: 'input-methods',
        labels: { en: 'Input methods', pt: 'Métodos de entrada' },
        match: {
          groups: ['fcitx5-im'],
          nameRegex: re('^fcitx', '^ibus-', 'input-method'),
        },
      },
    ],
  },
  {
    slug: 'internet',
    labels: { en: 'Network services', pt: 'Rede e serviços' },
    subcategories: [
      {
        slug: 'cloud-sync',
        labels: { en: 'Cloud sync', pt: 'Sincronização em nuvem' },
        match: {
          nameRegex: re('owncloud', 'nextcloud.*sync', 'cloud.*sync'),
        },
      },
      {
        slug: 'servers',
        labels: { en: 'Servers', pt: 'Servidores' },
        match: {
          sections: ['httpd'],
          nameRegex: re('-server$', '^nginx', '^apache', '^httpd', 'jabberd', 'ovenmediaengine'),
        },
      },
    ],
  },
  {
    slug: 'virtualization',
    labels: { en: 'Virtualization', pt: 'Virtualização' },
    subcategories: [
      {
        slug: 'containers',
        labels: { en: 'Containers', pt: 'Contêineres' },
        match: {
          nameRegex: re('^docker($|-)', '^podman($|-)', '^containerd$', '^buildah$', '^skopeo$', '^lxc($|-)', '^runc$', '^crun$', '^kubectl$', '^kube', '^helm($|-)'),
        },
      },
      {
        slug: 'virtual-machines',
        labels: { en: 'Virtual machines', pt: 'Máquinas virtuais' },
        match: {
          nameRegex: re('^qemu($|-)', '^libvirt($|-)', '^virt-', '^virtualbox($|-)', '^vagrant($|-)', '^spice-', '^edk2-'),
        },
      },
      {
        slug: 'emulators',
        labels: { en: 'Emulators', pt: 'Emuladores' },
        match: {
          nameRegex: re('emulator', '^dosbox', '^mame', '^wine($|-)', '^box86', '^box64'),
        },
      },
    ],
  },
  {
    slug: 'databases',
    labels: { en: 'Databases', pt: 'Bancos de dados' },
    subcategories: [
      {
        slug: 'servers',
        labels: { en: 'Database servers', pt: 'Servidores de banco de dados' },
        match: {
          nameRegex: re('^postgresql($|-)', '^mariadb($|-)', '^mysql($|-)', '^mongodb($|-)', '^redis($|-)', '^valkey($|-)', '^couchdb($|-)', '^influxdb($|-)'),
        },
      },
      {
        slug: 'clients',
        labels: { en: 'Database clients', pt: 'Clientes de banco de dados' },
        match: {
          nameRegex: re('^pgadmin', '^dbeaver', '^sqlitebrowser', '^sqlite-', 'database.*client', 'sql.*client'),
        },
      },
    ],
  },
  {
    slug: 'runtime-libs',
    labels: { en: 'Runtime libraries', pt: 'Bibliotecas e runtimes' },
    subcategories: [
      {
        slug: 'runtimes',
        labels: { en: 'Runtimes', pt: 'Runtimes' },
        match: {
          flathubKinds: ['runtime'],
          nameRegex: re('-runtime($|-)', '^openjdk', '^jre-', '^jdk-', '^dotnet-'),
        },
      },
      {
        slug: 'codecs',
        labels: { en: 'Codecs & media plugins', pt: 'Codecs e plugins de mídia' },
        match: {
          groups: ['gstreamer0.10-plugins', 'gst-plugins-rs'],
          nameRegex: re('codec', '^gst-plugins', '^gstreamer.*plugin', '^ffmpeg', '^libav', '^libdvd', '^libbluray'),
        },
      },
      {
        slug: 'plugins',
        labels: { en: 'Plugins & add-ons', pt: 'Plugins e complementos' },
        match: {
          nameRegex: re('-plugin($|-)', '-plugins($|-)', '-addon($|-)', '-addons($|-)'),
        },
      },
      {
        slug: 'shared-libs',
        labels: { en: 'Shared libraries', pt: 'Bibliotecas compartilhadas' },
        match: {
          sections: ['libs'],
          nameRegex: re('^lib[a-z0-9]'),
        },
      },
      {
        slug: 'language-bindings',
        labels: { en: 'Language bindings', pt: 'Bindings de linguagem' },
        match: {
          nameRegex: re('-bindings$', '^gobject-introspection'),
        },
      },
    ],
  },
  {
    slug: 'other',
    labels: { en: 'Other', pt: 'Outros' },
    subcategories: [
      {
        slug: 'uncategorized',
        labels: { en: 'Uncategorized', pt: 'Sem categoria' },
        match: {},
      },
    ],
  },
];

/* ──────────────── In-memory classifier (used by tests / hot paths) ──────────────── */

type RawMeta = Record<string, unknown> | null | undefined;
type PkgInput = { source: string; name: string; raw_metadata: RawMeta };

const lc = (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : '');

const matchesRules = (pkg: PkgInput, rules: MatchRules): boolean => {
  const meta = pkg.raw_metadata ?? {};
  if (rules.sections?.length) {
    const section = lc((meta as Record<string, unknown>)['section']);
    if (section && rules.sections.some((s) => s.toLowerCase() === section)) return true;
  }
  if (rules.groups?.length) {
    const raw = (meta as Record<string, unknown>)['GROUPS'];
    const groups = Array.isArray(raw) ? raw.map(lc) : [];
    if (groups.length && rules.groups.some((g) => groups.includes(g.toLowerCase()))) return true;
  }
  if (rules.repos?.length) {
    const repo = lc((meta as Record<string, unknown>)['repo']);
    if (repo && rules.repos.includes(repo)) return true;
  }
  if (rules.flathubKinds?.length && pkg.source === 'flathub') {
    const kind = lc((meta as Record<string, unknown>)['kind']);
    if (kind && rules.flathubKinds.includes(kind)) return true;
  }
  if (rules.nameRegex?.length) {
    if (rules.nameRegex.some((r) => r.test(pkg.name))) return true;
  }
  return false;
};

export function classifyPackage(pkg: PkgInput): { category: string; subcategory: string }[] {
  const out: { category: string; subcategory: string }[] = [];
  for (const cat of taxonomy) {
    if (cat.slug === 'other') continue;
    for (const sub of cat.subcategories) {
      if (matchesRules(pkg, sub.match)) {
        out.push({ category: cat.slug, subcategory: sub.slug });
        break; // first match per category wins
      }
    }
  }
  if (out.length === 0) out.push({ category: 'other', subcategory: 'uncategorized' });
  return out.slice(0, 3);
}

/* ──────────────── Counts (memoized 5 min) ──────────────── */

export type CategoryCount = { category: string; subcategory: string; count: number };

const COUNT_TTL_MS = 60 * 60 * 1000;
let countsCache: { at: number; data: CategoryCount[] } | null = null;

export async function getCategoryCounts(): Promise<CategoryCount[]> {
  const now = Date.now();
  if (countsCache && now - countsCache.at < COUNT_TTL_MS) return countsCache.data;

  /* Reads precomputed package.cat_path (single category/subcategory per row,
   * first match in taxonomy order). Backfilled by _backfill-cat-path.ts;
   * refreshed nightly after ingest. Drops cold-start from ~11s to ~50ms. */
  const rows = await db.execute<{ cat_path: string; n: number }>(sql`
    SELECT cat_path, COUNT(*)::int AS n
    FROM package
    WHERE cat_path IS NOT NULL AND moderation_status = 'approved'
    GROUP BY cat_path
  `);
  const countByPath = new Map<string, number>();
  for (const r of rows) countByPath.set(r.cat_path, r.n);

  const out: CategoryCount[] = [];
  for (const cat of taxonomy) {
    for (const s of cat.subcategories) {
      out.push({ category: cat.slug, subcategory: s.slug, count: countByPath.get(`${cat.slug}/${s.slug}`) ?? 0 });
    }
  }
  countsCache = { at: now, data: out };
  return out;
}

/** Pre-warm / reset (for tests). */
export function invalidateCategoryCounts(): void {
  countsCache = null;
}

/* ──────────────── Listing query ──────────────── */

export type CategoryPackage = {
  id: number;
  source: string;
  name: string;
  slug: string;
  canonicalSlug: string | null;
  summary: string | null;
  latestVersion: string | null;
  popularity: number;
};

export type CategoryListing = { items: CategoryPackage[]; total: number };

export async function getPackagesInCategory(
  categorySlug: string,
  subcategorySlug: string | undefined,
  limit: number,
  offset: number,
  search?: string,
): Promise<CategoryListing> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const q = (search ?? '').trim();
  const searchPred: SQL = q.length > 0
    ? sql`AND (name ILIKE ${'%' + q + '%'} OR canonical_slug ILIKE ${'%' + q + '%'})`
    : sql``;

  const catPathPred: SQL = subcategorySlug
    ? sql`cat_path = ${`${categorySlug}/${subcategorySlug}`}`
    : sql`cat_path LIKE ${`${categorySlug}/%`}`;

  const rows = await db.execute<{
    id: number; source: string; name: string; slug: string;
    canonical_slug: string | null; summary: string | null;
    latest_version_distro: string | null; popularity: number;
    total: number;
  }>(sql`
    WITH filtered AS (
      SELECT id, source, name, slug, canonical_slug,
             raw_metadata->>'desc' AS summary,
             latest_version_distro, popularity
      FROM package
      WHERE moderation_status = 'approved' AND ${catPathPred} ${searchPred}
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(canonical_slug, slug))
        id, source, name, slug, canonical_slug, summary,
        latest_version_distro, popularity
      FROM filtered
      ORDER BY COALESCE(canonical_slug, slug),
        CASE source WHEN 'flathub' THEN 4 WHEN 'manjaro' THEN 3
                    WHEN 'aur' THEN 2 WHEN 'debian' THEN 1 ELSE 0 END DESC,
        popularity DESC
    ),
    counted AS (SELECT COUNT(*)::int AS total FROM deduped)
    SELECT d.*, c.total
    FROM deduped d, counted c
    ORDER BY d.popularity DESC NULLS LAST, d.name ASC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `);

  const total = rows[0]?.total ?? 0;
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      source: r.source,
      name: r.name,
      slug: r.slug,
      canonicalSlug: r.canonical_slug,
      summary: r.summary,
      latestVersion: r.latest_version_distro,
      popularity: r.popularity,
    })),
  };
}

/* ──────────────── Faceted catalog query ──────────────── */

export type CatalogFacets = {
  category?: string;
  subcategory?: string;
  search?: string;
  maxAge?: number;          // keep packages with age_min <= maxAge
  includeUnrated?: boolean; // also keep unrated packages when maxAge is set
  componentType?: string;   // package_profile.component_type
  interfaceKind?: string;   // membership in package_profile.interface_kinds
  source?: string;          // package.source
  appsOnly?: boolean;       // drop dependency-only packages
};

export type CatalogPackage = {
  id: number;
  source: string;
  name: string;
  slug: string;
  canonicalSlug: string | null;
  summary: string | null;
  latestVersion: string | null;
  popularity: number;
  ageMin: number | null;
  dominantSource: string | null;
  componentType: string | null;
};

export type CatalogListing = { items: CatalogPackage[]; total: number };

/**
 * Faceted listing over the catalog. Exploits the indexed-but-unused
 * package_profile + rating_current columns. Dedupes by canonical_slug,
 * keeping the richest source as representative (flathub > manjaro > aur > debian).
 */
export async function queryCatalog(
  facets: CatalogFacets,
  limit: number,
  offset: number,
  locale?: string,
): Promise<CatalogListing> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const q = (facets.search ?? '').trim();
  /* DB translations use 'pt-br'; map the web locale and fall back to en/raw desc. */
  const trPrimary = locale === 'pt' ? 'pt-br' : (locale ?? 'en');

  const catPathPred: SQL = facets.category
    ? (facets.subcategory
        ? sql`AND cat_path = ${`${facets.category}/${facets.subcategory}`}`
        : sql`AND cat_path LIKE ${`${facets.category}/%`}`)
    : sql``;
  const searchPred: SQL = q.length > 0
    ? sql`AND (name ILIKE ${'%' + q + '%'} OR canonical_slug ILIKE ${'%' + q + '%'})`
    : sql``;
  const sourcePred: SQL = facets.source
    ? sql`AND source = ${facets.source}`
    : sql``;

  const agePred: SQL = facets.maxAge != null
    ? (facets.includeUnrated
        ? sql`AND (rc.age_min <= ${facets.maxAge} OR rc.age_min IS NULL)`
        : sql`AND rc.age_min <= ${facets.maxAge}`)
    : sql``;
  const typePred: SQL = facets.componentType
    ? sql`AND pr.component_type = ${facets.componentType}`
    : sql``;
  const ifacePred: SQL = facets.interfaceKind
    ? sql`AND pr.interface_kinds @> ${JSON.stringify([facets.interfaceKind])}::jsonb`
    : sql``;
  const appsOnlyPred: SQL = facets.appsOnly
    ? sql`AND COALESCE(pr.is_dependency_only, false) = false`
    : sql``;

  const rows = await db.execute<{
    id: number; source: string; name: string; slug: string;
    canonical_slug: string | null; summary: string | null;
    latest_version_distro: string | null; popularity: number;
    age_min: number | null; dominant_source: string | null;
    component_type: string | null; total: number;
  }>(sql`
    WITH filtered AS (
      SELECT id, source, name, slug, canonical_slug,
             raw_metadata->>'desc' AS raw_summary,
             latest_version_distro, popularity
      FROM package
      WHERE moderation_status = 'approved' ${catPathPred} ${searchPred} ${sourcePred}
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(canonical_slug, slug))
        id, source, name, slug, canonical_slug, raw_summary,
        latest_version_distro, popularity
      FROM filtered
      ORDER BY COALESCE(canonical_slug, slug),
        CASE source WHEN 'flathub' THEN 4 WHEN 'manjaro' THEN 3
                    WHEN 'aur' THEN 2 WHEN 'debian' THEN 1 ELSE 0 END DESC,
        popularity DESC
    ),
    enriched AS (
      SELECT d.id, d.source, d.name, d.slug, d.canonical_slug,
             COALESCE(tt.summary, d.raw_summary) AS summary,
             d.latest_version_distro, d.popularity,
             rc.age_min, rc.dominant_source, pr.component_type
      FROM deduped d
      LEFT JOIN rating_current rc ON rc.package_id = d.id
      LEFT JOIN package_profile pr ON pr.package_id = d.id
      LEFT JOIN LATERAL (
        SELECT t.summary
        FROM package_translation t
        WHERE t.package_id = d.id
          AND t.locale IN (${trPrimary}, 'en')
          AND t.summary IS NOT NULL AND length(t.summary) > 0
        ORDER BY CASE WHEN t.locale = ${trPrimary} THEN 0 ELSE 1 END,
                 CASE t.status WHEN 'official' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END
        LIMIT 1
      ) tt ON true
      WHERE TRUE ${agePred} ${typePred} ${ifacePred} ${appsOnlyPred}
    ),
    counted AS (SELECT COUNT(*)::int AS total FROM enriched)
    SELECT e.*, c.total
    FROM enriched e, counted c
    ORDER BY e.popularity DESC NULLS LAST, e.name ASC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `);

  const total = rows[0]?.total ?? 0;
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      source: r.source,
      name: r.name,
      slug: r.slug,
      canonicalSlug: r.canonical_slug,
      summary: r.summary,
      latestVersion: r.latest_version_distro,
      popularity: r.popularity,
      ageMin: r.age_min,
      dominantSource: r.dominant_source,
      componentType: r.component_type,
    })),
  };
}

/* ──────────────── Label helpers ──────────────── */

export function getCategoryLabel(slug: string, locale: Locale): string {
  const c = taxonomy.find((x) => x.slug === slug);
  if (!c) return slug;
  return c.labels[locale] ?? c.labels[defaultLocale] ?? slug;
}

export function getSubcategoryLabel(
  categorySlug: string,
  subSlug: string,
  locale: Locale,
): string {
  const c = taxonomy.find((x) => x.slug === categorySlug);
  const s = c?.subcategories.find((x) => x.slug === subSlug);
  if (!s) return subSlug;
  return s.labels[locale] ?? s.labels[defaultLocale] ?? subSlug;
}
