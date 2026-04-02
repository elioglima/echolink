Perfeito — isso aqui é **crítico** pro sucesso do projeto 👇
Se você não estruturar para desenvolvimento local desde o início, vira um caos depois.

Vou ajustar sua documentação já no nível **profissional de engenharia**, com foco em:

> 🧠 **DX (Developer Experience) + simulação de hardware local**

---

# 🎧 EchoLink Box — Documentação do Projeto (Versão Dev-First)

---

## 🧠 Visão Geral

**EchoLink Box** é um dispositivo físico de áudio inteligente que funciona como uma **interface USB com tradução de voz em tempo real**.

⚠️ Porém, o projeto é desenvolvido seguindo o princípio:

> 💻 **Tudo deve rodar localmente sem hardware (modo dev)**
> 🔌 O hardware é apenas uma camada de execução (runtime)

---

## 🎯 Princípio de Arquitetura

> **Hardware = Adapter**
> **Core = Independente**

---

## 🧩 Modos de Execução

O sistema possui **2 modos principais**:

### 🟢 1. Modo Desenvolvimento (LOCAL)

Roda no Mac/Windows/Linux sem Raspberry.

Simula:

* 🎤 entrada de áudio
* 🔊 saída de áudio
* 🔌 interface USB (virtual)
* 🎧 pipeline completo

---

### 🔵 2. Modo Hardware (Raspberry)

* roda no dispositivo físico
* usa USB Gadget real
* usa ALSA/PipeWire

---

## 🧠 Arquitetura Separada por Camadas

```text
+-----------------------------+
|        Applications         |
+-----------------------------+

+-----------------------------+
|      EchoLink Core          |
| (STT / Translate / TTS)     |
+-----------------------------+

+-----------------------------+
|   Audio Abstraction Layer   |
+-----------------------------+

+-----------------------------+
| Adapter: Local | USB Gadget |
+-----------------------------+
```

---

## 🧱 Estrutura do Projeto

```text
core/
├── domain/                  # regras puras
│   ├── audio_types.py
│   ├── pipeline_models.py
│   └── events.py
│
├── services/
│   ├── stt_service.py
│   ├── translate_service.py
│   ├── tts_service.py
│
├── pipeline/
│   ├── input_pipeline.py
│   ├── output_pipeline.py
│   └── orchestrator.py
│
├── recorder/
│   └── session_recorder.py
│
├── controller/
│   └── service_controller.py
│
├── adapters/
│   ├── audio/
│   │   ├── base.py
│   │   ├── local_audio.py        # DEV
│   │   └── alsa_audio.py         # RPI
│   │
│   ├── usb/
│   │   ├── base.py
│   │   ├── mock_usb.py           # DEV
│   │   └── gadget_usb.py         # RPI
│   │
│   └── devices/
│       └── device_manager.py
│
└── api/
    └── server.py
```

---

## 🔌 Abstração de Áudio (CRÍTICO)

Toda interação de áudio passa por interfaces:

```python
class AudioInput:
    def read_chunk() -> bytes

class AudioOutput:
    def write_chunk(data: bytes)
```

---

## 🎧 Implementações

### 🟢 Local (DEV)

* usa microfone do sistema
* usa speaker do sistema
* usa libs como:

  * sounddevice
  * pyaudio

---

### 🔵 Raspberry (PROD)

* usa ALSA / PipeWire
* usa USB Gadget

---

## 🔌 Abstração de USB

```python
class USBInterface:
    def start()
    def stop()
```

---

### 🟢 Mock USB (DEV)

Simula:

* entrada de áudio
* saída de áudio

Sem hardware.

---

### 🔵 Gadget USB (RPI)

* g_audio / UAC2
* aparece como:

  * EchoLink Mic
  * EchoLink Speaker

---

## 🔁 Pipeline (independente de hardware)

```text
AudioInput
→ VAD
→ STT
→ Translate
→ TTS
→ AudioOutput
```

---

## 🧪 Modo DEV — Execução Local

### Objetivo

Permitir que o dev rode:

```bash
python main.py --mode=dev
```

E tenha:

* 🎤 captura real do microfone
* 🔊 saída real no speaker
* logs completos
* gravação de sessão
* simulação do comportamento USB

---

## 🧪 Simulação de Fluxo USB

No modo DEV:

```text
Mic local
→ pipeline
→ speaker local
```

Simulando:

```text
USB IN → processamento → USB OUT
```

---

## 🎛️ Configuração via ENV

```bash
MODE=dev | rpi
AUDIO_DRIVER=local | alsa
USB_MODE=mock | gadget
STT_PROVIDER=local | cloud
TTS_PROVIDER=local | cloud
```

---

## 🧠 Injeção de Dependência

O sistema decide adapters em runtime:

```python
if config.mode == "dev":
    audio = LocalAudio()
    usb = MockUSB()
else:
    audio = ALSAAudio()
    usb = GadgetUSB()
```

---

## 🔁 Pipeline Orquestrado

```python
while True:
    chunk = audio_input.read_chunk()
    text = stt(chunk)
    translated = translate(text)
    audio_out = tts(translated)
    audio_output.write_chunk(audio_out)
```

---

## 🎙️ Gravação (Funciona nos dois modos)

* independente do ambiente
* grava áudio e eventos

---

## 🧪 Testes Locais

### Cenário 1

* falar no microfone
* ouvir traduzido no speaker

### Cenário 2

* rodar áudio de arquivo
* validar pipeline

### Cenário 3

* simular múltiplos usuários

---

## 🔥 Benefícios dessa abordagem

### 1. Desenvolvimento rápido

Sem depender de hardware

---

### 2. Testabilidade

Pipeline isolado

---

### 3. Portabilidade

Roda em qualquer ambiente

---

### 4. Escalabilidade

Fácil migrar para cloud/hardware

---

## ⚠️ Anti-pattern (evitar)

❌ acoplar pipeline ao ALSA
❌ depender do USB Gadget no core
❌ lógica misturada com hardware

---

## 🚀 Roadmap atualizado

### Fase 1 — DEV FIRST

* pipeline local funcionando
* áudio real (mic/speaker)
* gravação
* mock USB

---

### Fase 2 — INTEGRAÇÃO HARDWARE

* adapter ALSA
* adapter USB Gadget
* testes no Raspberry

---

### Fase 3 — PRODUTO

* firmware
* UX
* distribuição

---

## 💎 Filosofia do Projeto

> “Se roda no dev, roda no hardware.”

---

## 🎯 Conclusão

O EchoLink Box não começa como hardware.

Ele começa como:

> 🧠 **um core de processamento de áudio independente**

E depois:

> 🔌 o hardware apenas conecta esse core ao mundo físico

---

## 🚀 Próximo passo (recomendado)

Agora sim estamos prontos para começar certo.

Sugestão:

👉 Criar o **core + modo dev funcionando primeiro**

Se quiser, no próximo passo eu já te entrego:

* 🔧 `main.py` pronto
* 🎤 captura de áudio real
* 🔁 pipeline inicial funcionando
* 🧪 modo dev executável

Só fala:

> “vamos começar o core”

que a gente entra na implementação 🔥
