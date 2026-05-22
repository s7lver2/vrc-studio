let
  pkgs = import <nixpkgs> {
    overlays = [
      (import (fetchTarball "https://github.com/oxalica/rust-overlay/archive/master.tar.gz"))
    ];
  };
in
pkgs.mkShell {
  packages = with pkgs; [
    nodejs
    pkg-config

    rust-bin.stable.latest.default

    gtk3
    glib
    gobject-introspection
    cairo
    pango
    atk

    webkitgtk_4_1
    libsoup_3

    openssl
    openssl.dev

    libayatana-appindicator

    # Añade estos dos: el módulo TLS y su biblioteca base
    glib-networking
    gnutls   # O también puedes usar openssl, pero glib-networking suele usar gnutls
  ];

  shellHook = ''
    export LD_LIBRARY_PATH=${pkgs.libayatana-appindicator}/lib:$LD_LIBRARY_PATH

    # Hacemos disponible el módulo TLS de GLib
    export GIO_EXTRA_MODULES=${pkgs.glib-networking}/lib/gio/modules
  '';
}