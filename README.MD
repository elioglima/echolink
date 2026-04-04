# EchoLink

Middleware de áudio com **tradução de voz em tempo real** (PT ↔ EN). O produto-alvo é o **EchoLink Box** (interface USB inteligente); o repositório organiza o **core de processamento** e as **applications** (serviço local + UI).

## Resumo

- **Core independente do hardware:** pipeline (áudio → STT → tradução → TTS → áudio) não deve acoplar ALSA, USB Gadget ou detalhes de placa.
- **Hardware = adapter:** no Raspberry, áudio/USB entram como implementações; em desenvolvimento usam-se adapters **locais** e **mock** de USB.
- **Dev-first:** tudo deve rodar no Mac/Windows/Linux **sem Raspberry** — mic/speaker reais, simulação do fluxo USB, logs e gravação de sessão.

## Pontos importantes

| Tema | Diretriz |
|------|-----------|
| Modos | **dev** (local + mock USB) vs **hardware** (RPI + ALSA/PipeWire + Gadget) |
| Abstração de áudio | Entrada/saída via interfaces (`read_chunk` / `write_chunk`), não chamadas diretas ao driver |
| Abstração de USB | Mock em dev; Gadget real em produção no RPi |
| Config | `MODE`, drivers de áudio/USB e provedores STT/TTS via ambiente (ver `mds/resume.md`) |
| Anti-patterns | Não misturar pipeline com ALSA; não depender de Gadget no core |

## Estrutura do repositório

- `applications/echoLinkService` — serviço Python (API local, pipeline em evolução).
- `applications/echolinkApp` — interface Next.js + Electron.
- `mds/` — documentação detalhada (visão de arquitetura, roadmap, convenções).

## Instalação e execução no macOS (pyenv + nvm)

### Ferramentas no Mac

1. **Xcode Command Line Tools** (necessário para compilar Python com pyenv):

   ```bash
   xcode-select --install
   ```

2. **Homebrew** (se ainda não tiver): [https://brew.sh](https://brew.sh)

3. **pyenv**:

   ```bash
   brew install pyenv
   ```

   No `~/.zprofile` ou `~/.zshrc` (shell padrão do macOS é o **zsh**):

   ```bash
   eval "$(pyenv init -)"
   ```

   Abra um terminal novo ou `source` o ficheiro.

4. **nvm** (instalação oficial via script):

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
   ```

   Reinicie o terminal ou `source ~/.nvm/nvm.sh`.

### Serviço Python (`echoLinkService`)

O interpretador está fixo em `applications/echoLinkService/.python-version` (**3.12**). O `pyproject.toml` exige **Python ≥ 3.11**.

```bash
cd applications/echoLinkService

pyenv install -s 3.12
pyenv local 3.12

python -m venv .venv
source .venv/bin/activate

pip install -U pip setuptools wheel
pip install -e .

# API em http://127.0.0.1:8765 (WebSockets: /ws/mic, /ws/stt)
python main.py
```

Alternativa na pasta do serviço: `./configure.sh` (cria/usa `.venv`, instala dependências, tenta detetar `VOSK_MODEL_PATH` em pastas locais e sobe o Uvicorn com reload).

Variável opcional: `ECHO_LINK_RELOAD=0` desativa o reload automático quando usas `python main.py`.

**Configuração (fonte de verdade no servidor):** `GET http://127.0.0.1:8765/config` devolve o JSON de settings; `PATCH` com o mesmo formato aplica alterações parciais. A UI envia `PATCH` ao mudar opções (o `localStorage` fica como cache quando o serviço está offline).

### App Next.js (`echolinkApp`)

A versão do Node está em `applications/echolinkApp/.nvmrc` (**22**).

```bash
cd applications/echolinkApp

nvm install
nvm use

npm install
npm run dev
```

A UI fica em **http://127.0.0.1:3000** e espera o serviço Python na porta **8765**; inicie o `echoLinkService` antes ou em paralelo ao `npm run dev`.

**Desktop (Electron + Next):** `npm run dev:desktop`.

### Dois terminais (recomendado)

| Terminal | Pasta | Comando |
|----------|--------|---------|
| 1 | `applications/echoLinkService` | `source .venv/bin/activate` → `python main.py` (ou `./configure.sh`) |
| 2 | `applications/echolinkApp` | `nvm use` → `npm run dev` |

### Desenvolvimento no Mac (sem Raspberry Pi)

Quem desenvolve **não precisa de Raspberry Pi** para executar e testar: o Mac usa microfone e saída de áudio normais; o **USB gadget** do produto final só entra no modo **hardware** no Pi (ver `mds/resume.md`).

1. **Serviço Python** — terminal na pasta `applications/echoLinkService` (como acima ou `./configure.sh`).
2. **UI** — terminal na pasta `applications/echolinkApp`, `npm run dev`, abrir **http://127.0.0.1:3000** e autorizar o microfone no browser.
3. **STT com Vosk (opcional)** — descarregar um modelo em [alphacephei.com/vosk/models](https://alphacephei.com/vosk/models), descompactar em `applications/echoLinkService/vosk-model` (ou definir `VOSK_MODEL_PATH` para a pasta do modelo). Sem modelo, o resto da interface continua utilizável; o passo fala→texto via Vosk fica indisponível.
4. **Verificação rápida** — `curl -s http://127.0.0.1:8765/health` e `curl -s http://127.0.0.1:8765/stt/status`.

## Documentação

Detalhes de camadas, pastas sugeridas do `core`, roadmap e filosofia **“se roda no dev, roda no hardware”**: `mds/resume.md`.
