# Áudio virtual no macOS (desenvolvimento local)

## Opção A: driver EchoLink (neste repositório)

O projeto inclui **`applications/echoLinkVirtualAudio`**: fork do BlackHole personalizado como **EchoLink Virtual Audio**. Veja [README.pt-BR.md](../applications/echoLinkVirtualAudio/README.pt-BR.md) (compilar no Xcode, instalar o `.driver`, licença GPL-3.0).

No **echolinkApp**, em Canais de entrada / Saída de áudio, escolha o dispositivo cujo nome começa com **EchoLink Virtual Audio** (o sufixo de canais e o texto após `·` vêm do navegador).

## Opção B: BlackHole oficial

1. Instalar **[BlackHole 2ch](https://existential.audio/blackhole/)**.
2. Em **Ajustes → Som**, usar **BlackHole 2ch** como entrada e/ou saída.

### Ouvir o Mac e enviar áudio ao loopback

1. **Aplicativos → Utilitários → Configuração de Áudio e MIDI**.
2. **+** → **Criar dispositivo com saídas múltiplas**.
3. Marcar **Alto-falantes** (ou fones) **e** o dispositivo virtual (EchoLink ou BlackHole).
4. Definir esse dispositivo múltiplo como saída do sistema.

## Raspberry Pi (produção)

No Pi usa-se **ALSA loopback**, **PipeWire** ou **USB gadget**, via adapters — não o driver macOS.
