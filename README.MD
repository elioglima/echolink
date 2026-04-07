# EchoLink

**EchoLink** é uma plataforma de áudio com **reconhecimento de voz (STT)**, **tradução** e **síntese de voz (TTS)**, orientada ao produto **EchoLink Box** (interface USB no Raspberry Pi). Este repositório contém o **serviço local de processamento** (Python), a **interface** (Next.js + Electron), e o **driver de áudio virtual** para macOS.

## O que o projeto faz

| Área | Descrição |
|------|-----------|
| **Captura** | Microfone e outras entradas (linha, mídia) com mesa de mistura, VU, roteamento **Master** / **Monitor** e envio do áudio ao serviço via WebSocket. |
| **STT** | Transcrição em tempo real: **Amazon Transcribe** (streaming) ou **Vosk** (local), conforme configuração. |
| **Tradução com voz** | Texto PT → tradução (ex.: EN) via **Amazon Translate** + **ElevenLabs** (TTS), com reprodução na saída escolhida. |
| **Configuração** | Estado partilhado entre UI e serviço: `GET/PATCH /config`, persistência em cache local de ficheiros no serviço. |
| **Sessões / histórico** | API de chats e integração com armazenamento local no cliente (IndexedDB) para vocabulário e jornal de frases. |
| **Áudio virtual (macOS)** | Driver **EchoLink Virtual Audio** (multicanal) para encaminhar o programa para outras aplicações; ver pasta `echoLinkVirtualAudio`. |

O **core** do pipeline (STT, tradução, TTS, domínio) **não depende** de ALSA, USB Gadget nem drivers de placa: o hardware entra apenas por **adapters** (local/mock em desenvolvimento; ALSA/gadget no Raspberry Pi).

## Princípios de arquitetura

- **Dev-first:** o fluxo completo deve correr em Mac/Windows/Linux **sem** Raspberry Pi (microfone e altifalantes reais, mocks onde fizer sentido).
- **Processamento no serviço Python:** regras de domínio, STT, tradução e TTS na API; o cliente envia áudio/configurações, recebe resultados e gere Web Audio (mistura, VU, dispositivos).
- **Nomes em inglês** no código (funções, tipos, ficheiros novos em **camelCase** quando o projeto já usa esse padrão).

## Estrutura do repositório

```
echoLink/
├── applications/
│   ├── echoLinkService/      # API FastAPI (Uvicorn): /config, /ws/mic, /ws/stt, tradução, chats, runtime
│   ├── echolinkApp/          # UI Next.js (App Router) + Electron; Web Audio; liga ao serviço em :8765
│   └── echoLinkVirtualAudio/ # Driver macOS (extensão de áudio; GPL-3.0; ver README.pt-BR.md)
├── mds/                      # Documentação extra (arquitetura, áudio virtual no Mac)
├── .gitignore                # Inclui .env e .env.* — ver secção «Variáveis de ambiente»
└── README.MD                 # Este ficheiro
```

### `applications/echoLinkService` (Python)

- **Entrada:** `main.py`, `pyproject.toml`, `start.sh` / `configure.sh`.
- **`core/api/`:** rotas HTTP/WebSocket (`config`, `mic`, `stt`, `voiceTranslation`, `chats`, `runtime`, etc.).
- **`core/stt/`:** motor de transcrição (AWS, Vosk).
- **`core/voiceTranslation/`:** tradução + TTS agregados.
- **`core/config/`:** modelo de configuração EchoLink e escrita em `files/cache/configs/`.
- **`files/cache/`:** configs, estado de runtime, chats, vocabulário (desenvolvimento local).

### `applications/echolinkApp` (TypeScript / React)

- **`app/`:** páginas e layout Next.js.
- **`components/`:** UI principal (ex.: `micCapture.tsx`, consola de mistura, painéis de entrada/saída).
- **`lib/`:** clientes HTTP/WebSocket, settings, pipeline de áudio, tradução, journal, etc.

## Stack técnica

| Camada | Tecnologias |
|--------|-------------|
| Serviço | Python **3.11+** (recomendado **3.12**), **FastAPI**, **Uvicorn**, cliente AWS (Transcribe, Translate), HTTP/WebSocket |
| Frontend | **Next.js**, **React**, **TypeScript**, **Electron** (modo desktop) |
| Áudio (browser) | Web Audio API, `MediaRecorder`, `setSinkId` onde disponível |
| Áudio (macOS) | Extensão **EchoLink Virtual Audio** (CoreAudio) |

## Variáveis de ambiente e segredos

**Não commite ficheiros `.env`** nem cópias com credenciais. O `.gitignore` na raiz inclui:

- `.env`
- `.env.*` (cobre `.env.local`, `.env.development`, `.env.production`, etc.)

O serviço e scripts podem usar variáveis como (nomes indicativos; valores ficam só na sua máquina):

| Variável / tema | Uso |
|-----------------|-----|
| `AWS_PROFILE` / `ECHO_LINK_AWS_PROFILE` | Perfil AWS para Transcribe e Translate |
| `ECHO_LINK_STT_ENGINE` | `aws` ou Vosk local |
| `VOSK_MODEL_PATH` | Pasta do modelo Vosk (alternativa a modelo em `models/`) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | ElevenLabs (tradução com voz) |
| `ECHO_LINK_BIND_HOST`, `ECHO_LINK_BIND_PORT` | Bind do Uvicorn (predefinição comum: `127.0.0.1:8765`) |

Para partilhar exemplos no repositório, use um ficheiro **`env.example`** (sem segredos) se for criado no futuro; o padrão `.env.*` pode ser ajustado com `!.env.example` para permitir esse ficheiro.

## Instalação e execução (resumo)

### Requisitos

- **Python** 3.11+ (o projeto fixa **3.12** em `echoLinkService/.python-version`).
- **Node.js** alinhado a `echolinkApp/.nvmrc` (ex.: **22**).

### Serviço Python

```bash
cd applications/echoLinkService
pyenv install -s 3.12 && pyenv local 3.12   # opcional
python -m venv .venv && source .venv/bin/activate
pip install -U pip setuptools wheel && pip install -e .
python main.py
# API: http://127.0.0.1:8765  |  WebSockets: /ws/mic, /ws/stt
```

Alternativa: `./configure.sh` ou `./start.sh` na mesma pasta (instala dependências e sobe o servidor).

### App web / desktop

```bash
cd applications/echolinkApp
nvm use
npm install
npm run dev          # http://127.0.0.1:3000 — espera o serviço na porta 8765
npm run dev:desktop  # Electron + Next em desenvolvimento
```

### Verificação rápida

```bash
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/stt/status
```

## API e endpoints úteis (serviço)

| Método / caminho | Descrição |
|------------------|-----------|
| `GET /health` | Estado do serviço |
| `GET/PATCH /config` | Configuração EchoLink (JSON) |
| `WS /ws/mic` | Receção de chunks de áudio (binário) |
| `WS /ws/stt` | PCM mono 16 kHz s16le para transcrição |
| `POST /voiceTranslation/...` | Tradução + síntese de voz (ver rotas em `voiceTranslationRoutes`) |
| `GET /capture/info` | Metadados dos caminhos WebSocket e cache |

Lista completa: código em `applications/echoLinkService/core/api/`.

## Documentação adicional

- `mds/resume.md` — visão de arquitetura, modos dev vs hardware, convenções.
- `mds/devVirtualAudioMac.md` — áudio virtual no Mac (EchoLink Virtual / BlackHole).
- `applications/echoLinkVirtualAudio/README.pt-BR.md` — compilação e instalação do driver macOS.

## Licença

O projeto principal não inclui um `LICENSE` na raiz. O subprojeto **`applications/echoLinkVirtualAudio`** inclui licenciamento **GPL-3.0** (ver `applications/echoLinkVirtualAudio/LICENSE`).
