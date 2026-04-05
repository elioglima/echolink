#!/usr/bin/env sh
set -euo pipefail

# Creates installer for different channel versions.
# Run this script from the local BlackHole repo's root directory.
# If this script is not executable from the Terminal, 
# it may need execute permissions first by running this command:
#   chmod +x create_installer.sh

driverName="EchoLinkVirtualAudio"
devTeamID="Q5C99V536K"
notarize=true # To skip notarization, set this to false
notarizeProfile="notarize" # ⚠️ Replace this with your own notarytool keychain profile name

############################################################################

# Basic Validation
if [ ! -d EchoLinkVirtualAudio.xcodeproj ]; then
    echo "Execute a partir da pasta applications/echoLinkVirtualAudio."
    exit 1
fi

version=`cat VERSION`

#Version Validation6
if [ -z "$version" ]; then
    echo "Could not find version number. VERSION file is missing from repo root or is empty."
    exit 1
fi

for channels in 2 8 16 64 128 256; do
    # Env
    ch=$channels"ch"
    driverVartiantName=$driverName$ch
    bundleID="audio.neocoode.$driverVartiantName"
    
    # Build
    xcodebuild \
      -project EchoLinkVirtualAudio.xcodeproj \
      -configuration Release \
      -target EchoLinkVirtualAudio CONFIGURATION_BUILD_DIR=build \
      PRODUCT_BUNDLE_IDENTIFIER=$bundleID \
      PRODUCT_NAME=$driverVartiantName \
      GCC_PREPROCESSOR_DEFINITIONS='$GCC_PREPROCESSOR_DEFINITIONS 
      kNumber_Of_Channels='$channels' 
      kPlugIn_BundleID=\"'$bundleID'\"'
    
    # Generate a new UUID
    uuid=$(uuidgen)
    builtDriver="build/$driverVartiantName.driver"
    awk '{sub(/e395c745-4eea-4d94-bb92-46224221047c/,"'$uuid'")}1' "$builtDriver/Contents/Info.plist" > Temp.plist
    mv Temp.plist "$builtDriver/Contents/Info.plist"
    
    mkdir Installer/root
    driverBundleName=$driverVartiantName.driver
    mv "$builtDriver" Installer/root/$driverBundleName
    rm -r build
    
    # Sign
    codesign \
      --force \
      --deep \
      --options runtime \
      --sign $devTeamID \
      Installer/root/$driverBundleName
    
    # Create package with pkgbuild
    chmod 755 Installer/Scripts/preinstall
    chmod 755 Installer/Scripts/postinstall
    
    pkgbuild \
      --sign $devTeamID \
      --root Installer/root \
      --scripts Installer/Scripts \
      --install-location /Library/Audio/Plug-Ins/HAL \
      "Installer/$driverName.pkg"
    rm -r Installer/root
    
    # Create installer with productbuild
    cd Installer
    
    echo "<?xml version=\"1.0\" encoding='utf-8'?>
    <installer-gui-script minSpecVersion='2'>
        <title>$driverName: Audio Loopback Driver ($ch) $version</title>
        <welcome file='welcome.html'/>
        <license file='../LICENSE'/>
        <conclusion file='conclusion.html'/>
        <domains enable_anywhere='false' enable_currentUserHome='false' enable_localSystem='true'/>
        <pkg-ref id=\"$bundleID\"/>
        <options customize='never' require-scripts='false' hostArchitectures='x86_64,arm64'/>
        <volume-check>
            <allowed-os-versions>
                <os-version min='12.3'/>
            </allowed-os-versions>
        </volume-check>
        <choices-outline>
            <line choice=\"$bundleID\"/>
        </choices-outline>
        <choice id=\"$bundleID\" visible='true' title=\"$driverName $ch\" start_selected='true'>
            <pkg-ref id=\"$bundleID\"/>
        </choice>
        <pkg-ref id=\"$bundleID\" version=\"$version\" onConclusion='RequireRestart'>$driverName.pkg</pkg-ref>
    </installer-gui-script>" >> distribution.xml
    
    # Build
    installerPkgName="$driverVartiantName-$version.pkg"
    productbuild \
      --sign $devTeamID \
      --distribution distribution.xml \
      --resources . \
      --package-path $driverName.pkg $installerPkgName
    rm distribution.xml
    rm -f $driverName.pkg
    
    # Notarize and Staple
    if [ "$notarize" = true ]; then
        xcrun \
          notarytool submit $installerPkgName \
          --team-id $devTeamID \
          --progress \
          --wait \
          --keychain-profile $notarizeProfile
        
        xcrun stapler staple $installerPkgName
    fi

    cd ..
done