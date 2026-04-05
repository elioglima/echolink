#!/usr/bin/env sh
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$root/build/EchoLinkVirtualAudio8ch.driver}"
installName="${INSTALL_DRIVER_NAME:-EchoLinkVirtualAudio8ch.driver}"
dest="/Library/Audio/Plug-Ins/HAL/$installName"
restartAudio="${RESTART_AUDIO:-1}"
hal="/Library/Audio/Plug-Ins/HAL"

echo "Executando build.sh..."
"$root/build.sh"

for path in "$hal"/EchoLinkVirtualAudio*.driver; do
  [ -d "$path" ] || continue
  echo "Removendo instalado: $path (sudo)..."
  sudo rm -rf "$path"
done

echo "Encerrando coreaudiod para descarregar drivers (sudo)..."
sudo killall coreaudiod 2>/dev/null || true

if [ ! -d "$src" ]; then
  echo "Bundle do driver nao encontrado: $src"
  exit 1
fi

echo "Instalando em $dest (sudo)..."
sudo rm -rf "$dest"
sudo cp -R "$src" "$dest"
sudo chown -R root:wheel "$dest"

case "$(printf '%s' "$restartAudio" | tr '[:upper:]' '[:lower:]')" in
  0|false|no|off)
    echo "Concluido. RESTART_AUDIO=0: coreaudiod nao foi reiniciado. Se o dispositivo nao aparecer: sudo killall coreaudiod"
    ;;
  *)
    echo "Reiniciando coreaudiod (sudo)..."
    sudo killall coreaudiod 2>/dev/null || true
    echo "Concluido. coreaudiod foi reiniciado; o dispositivo deve aparecer no Audio MIDI Setup."
    ;;
esac
