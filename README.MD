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

## Aplicações no repositório

Cada pasta em `applications/` é um artefacto distinto: descrição, tecnologias e **serviços externos** (cloud ou APIs de terceiros).

### `echoLinkService` — API e pipeline local (Python)

| | |
|--|--|
| **Descrição** | Serviço **FastAPI** em **Uvicorn** que expõe REST, WebSockets e a lógica de STT, tradução PT→EN, TTS, estado de runtime, chats e cache em ficheiros. Recebe áudio da UI (`/ws/mic`, `/ws/stt`), aplica regras de qualidade de texto e orquestra integrações AWS/ElevenLabs quando configuradas. Inclui modo **Vosk** totalmente local, sem cloud. |
| **Tecnologias** | Python **≥ 3.11** (recomendado **3.12**), **FastAPI**, **Uvicorn** `[standard]`, **boto3**, **amazon-transcribe**, **vosk**, **httpx**; estrutura em `core/` (`api`, `stt`, `voiceTranslation`, `config`, `files`). Entrada: `main.py`, `pyproject.toml`, scripts `start.sh` / `configure.sh`. |
| **Serviços externos** | **Amazon Web Services** (credenciais via perfil AWS): **Transcribe** (streaming STT), **Translate** (tradução de texto). **ElevenLabs** (API REST: síntese de voz / TTS a partir do texto traduzido). *Opcional:* apenas Vosk local — sem STT/tradução/TTS na nuvem se não configurar AWS/ElevenLabs. |

Pastas úteis: `core/api/` (rotas), `core/stt/`, `core/voiceTranslation/`, `files/cache/` (configs, runtime, chats).

### `echolinkApp` — interface web e desktop (Next.js + Electron)

| | |
|--|--|
| **Descrição** | Aplicação **Next.js** (App Router) com **React** para a mesa EchoLink: captura de áudio no browser, mistura multi-canal (Web Audio), VU, roteamento Master/Monitor, chat de transcrição, definições sincronizadas com o serviço (`/config`). Modo **Electron** para ambiente tipo desktop (`npm run dev:desktop`). Comunica com o **echoLinkService** em `http://127.0.0.1:8765` (HTTP + WebSocket); não embute STT/tradução no bundle — delega ao Python. |
| **Tecnologias** | **Next.js** 16, **React** 19, **TypeScript**, **Tailwind CSS** 4, **ESLint**; **Electron** 35 (dev); **concurrently** / **wait-on** para dev desktop. Pastas: `app/`, `components/`, `lib/` (clientes, settings, áudio, journal). |
| **Serviços externos** | **Nenhuma chamada direta** da UI a AWS ou ElevenLabs no fluxo normal: os pedidos vão ao **serviço local**. Serviços na nuvem são utilizados **indiretamente**, só quando o **echoLinkService** está configurado e encaminha STT/tradução/TTS. |

### `echoLinkVirtualAudio` — driver de áudio virtual (macOS)

| | |
|--|--|
| **Descrição** | Extensão **HAL** Core Audio que cria dispositivos virtuais **loopback** (ex.: **EchoLink Virtual Audio 8ch**) para encaminhar o som da mesa/aplicações para outras apps no Mac (Teams, navegador, gravação). Fork do **BlackHole**; necessário para cenários de integração local sem hardware dedicado. |
| **Tecnologias** | **Xcode**, projeto **Core Audio** (plug-in HAL); base **C/C++/Objective-C** herdada do upstream BlackHole; scripts `build.sh`, `install.sh`, instalador opcional em `Installer/`. Licença **GPL-3.0** (ver `LICENSE` na pasta). |
| **Serviços externos** | **Nenhum** — compilação e execução são 100 % locais; apenas **Apple Developer** (assinatura/notarização) se distribuir binários assinados. |

## Stack técnica (visão rápida)

| Camada | Tecnologias |
|--------|-------------|
| Serviço | Python, FastAPI, Uvicorn, boto3, amazon-transcribe, vosk, httpx |
| Frontend | Next.js, React, TypeScript, Tailwind, Electron |
| Áudio (browser) | Web Audio API, MediaRecorder, `setSinkId` quando suportado |
| Áudio (macOS) | EchoLink Virtual Audio (HAL), Core Audio |

## Tecnologias, AWS e serviços de terceiros

### Tecnologias por camada

| Área | Tecnologias |
|------|-------------|
| **Backend (`echoLinkService`)** | Python ≥ 3.11, **FastAPI**, **Uvicorn**, **boto3** / botocore, **amazon-transcribe** (streaming), **vosk**, **httpx** |
| **Frontend (`echolinkApp`)** | **Next.js**, **React**, **TypeScript**, **Tailwind CSS**, **Electron** (opcional), ESLint; **concurrently** / **wait-on** (dev desktop) |
| **Áudio no browser** | Web Audio API, **MediaRecorder**, WebSocket para o serviço local |
| **Driver macOS (`echoLinkVirtualAudio`)** | **Xcode**, Core Audio HAL, C/C++/Objective-C (fork **BlackHole**) |

### AWS (via `echoLinkService`)

Credenciais: perfil AWS (`AWS_PROFILE` / `ECHO_LINK_AWS_PROFILE`); região típica em `AWS_REGION` (ex.: `us-east-1`).

| Serviço AWS | Uso no EchoLink |
|-------------|-----------------|
| **Amazon Transcribe** | STT em **streaming** quando `ECHO_LINK_STT_ENGINE=aws` — WebSocket `/ws/stt` com PCM mono 16 kHz. |
| **Amazon Translate** | Tradução de texto **PT → EN** na pipeline de voz traduzida (`boto3` cliente `translate`). |

**Alternativa sem AWS para STT:** **Vosk** (modelo local em disco) — não é serviço na nuvem.

### Terceiros (não AWS)

| Serviço | Uso |
|---------|-----|
| **ElevenLabs** (`api.elevenlabs.io`) | **TTS**: síntese de voz a partir do texto já traduzido (ex.: inglês). Requer `ELEVENLABS_API_KEY` e identificador de voz. |
| **Vosk** (Alphacephei) | Apenas o **ficheiro do modelo** descarregado para o disco — execução **local**, sem API paga em runtime. |

### Nota sobre a UI

A **echolinkApp** não chama diretamente AWS nem ElevenLabs: comunica só com **`http://127.0.0.1:8765`**. Quem integra nuvem é o **echoLinkService**.

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
