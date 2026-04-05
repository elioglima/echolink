# EchoLink Virtual Audio (macOS)

Driver de áudio virtual **loopback** para desenvolvimento no Mac: aparece como **entrada e saída** em Som, Teams, navegador, etc.

## Origem e licença

Este diretório é um **fork** do projeto [BlackHole](https://github.com/ExistentialAudio/BlackHole) (Existential Audio Inc.), sob **GNU GPL v3**. O código-fonte das alterações da Neocoode está neste repositório. Se você distribuir binários do driver, cumpre a GPL (incluindo oferta de fonte correspondente). O app **echolinkApp** continua separado; apenas o bundle `.driver` é derivado do BlackHole.

## Nome no sistema

Após instalar, o dispositivo principal (build padrão 2 canais) costuma aparecer como **EchoLink Virtual Audio 2ch** (varia conforme a lista do macOS).

## Compilar no Xcode

1. Abrir `EchoLinkVirtualAudio.xcodeproj`.
2. Em **Signing & Capabilities**, escolha o seu **Team** (Apple Developer).
3. **Product → Build**. O artefato fica em `EchoLinkVirtualAudio.driver`.

## Instalar manualmente (dev)

```bash
sudo cp -R caminho/para/EchoLinkVirtualAudio.driver /Library/Audio/Plug-Ins/HAL/
sudo chown -R root:wheel /Library/Audio/Plug-Ins/HAL/EchoLinkVirtualAudio.driver
```

Reiniciar o Mac ou terminar sessão pode ser necessário para o Core Audio recarregar.

## Pacote (.pkg)

O script `Installer/create_installer.sh` gera instaladores por variantes de canal; ajuste `devTeamID` e perfil de notarização antes de usar em produção.

## Conflito com BlackHole oficial

Não instale os dois ao mesmo tempo se usarem o mesmo tipo de plug-in, para evitar confusão. Desinstale um antes de testar o outro.

## Upstream

Para bugs do motor original, consulte o [repositório BlackHole](https://github.com/ExistentialAudio/BlackHole).
