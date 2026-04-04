#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export ECHO_LINK_AWS_PROFILE="${ECHO_LINK_AWS_PROFILE:-dev-neocoode}"
export AWS_PROFILE="${AWS_PROFILE:-$ECHO_LINK_AWS_PROFILE}"
# export ELEVENLABS_VOICE_ID="${ECHO_LINK_ELEVENLABS_VOICE_ID:-hpp4J3VqNfWAUOO0d1Us}"

STT_ENGINE="${ECHO_LINK_STT_ENGINE:-aws}"
export ECHO_LINK_STT_ENGINE="$STT_ENGINE"

VOSK_ZIP_URL="https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip"
VOSK_MODEL_DIR="$SCRIPT_DIR/models/vosk-model-small-pt-0.3"

model_dir_valid() {
  [[ -d "$1" ]] && { [[ -f "$1/final.mdl" ]] || [[ -f "$1/am/final.mdl" ]] || [[ -f "$1/conf/model.conf" ]]; }
}

if command -v pyenv >/dev/null 2>&1; then
  pyenv install -s 3.12
  pyenv local 3.12
  PYTHON_CMD=python
else
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD=python3
  else
    PYTHON_CMD=python
  fi
fi

if ! command -v "$PYTHON_CMD" >/dev/null 2>&1; then
  echo "Python não encontrado. Instale Python 3.11+ ou pyenv com 3.12." >&2
  exit 1
fi

if ! "$PYTHON_CMD" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
  echo "Python 3.11+ é necessário (obtido: $($PYTHON_CMD -V 2>&1))." >&2
  exit 1
fi

if [[ ! -d .venv ]]; then
  "$PYTHON_CMD" -m venv .venv
fi
source .venv/bin/activate

python -m pip install -q -U pip setuptools wheel
python -m pip install -q -e .

if [[ "$STT_ENGINE" == "vosk" ]]; then
  resolved_vosk=""
  if [[ -n "${VOSK_MODEL_PATH:-}" ]] && model_dir_valid "$VOSK_MODEL_PATH"; then
    resolved_vosk="$VOSK_MODEL_PATH"
  else
    for candidate in \
      "$SCRIPT_DIR/vosk-model" \
      "$SCRIPT_DIR/vosk-model-small-pt-0.3" \
      "$VOSK_MODEL_DIR"
    do
      if model_dir_valid "$candidate"; then
        resolved_vosk="$candidate"
        break
      fi
    done
  fi

  if [[ -z "$resolved_vosk" ]]; then
    if ! command -v unzip >/dev/null 2>&1; then
      echo "Instale 'unzip' para extrair o modelo Vosk (ex.: brew install unzip)." >&2
      exit 1
    fi
    mkdir -p "$SCRIPT_DIR/models"
    zip_path="$SCRIPT_DIR/models/.vosk-model-small-pt-0.3.download.zip"
    echo "Baixando modelo Vosk (português, small)…"
    if ! curl -fsSL "$VOSK_ZIP_URL" -o "$zip_path"; then
      echo "Falha ao baixar o modelo. Verifique a rede ou defina VOSK_MODEL_PATH manualmente." >&2
      rm -f "$zip_path"
      exit 1
    fi
    unzip -q -o "$zip_path" -d "$SCRIPT_DIR/models"
    rm -f "$zip_path"
    if ! model_dir_valid "$VOSK_MODEL_DIR"; then
      echo "Modelo Vosk inválido após descompactar (esperado em $VOSK_MODEL_DIR)." >&2
      exit 1
    fi
    resolved_vosk="$VOSK_MODEL_DIR"
  fi

  export VOSK_MODEL_PATH="$resolved_vosk"
else
  export VOSK_MODEL_PATH=""
fi

reload_args=(--reload)
if [[ "${ECHO_LINK_RELOAD:-1}" == "0" ]]; then
  reload_args=()
fi

exec uvicorn core.api.server:app "${reload_args[@]}" --host 127.0.0.1 --port 8765
