; Orbit assisted-installer customizations (auto-loaded as build/installer.nsh).
; Adds an "Install options" page after the directory page:
;   - desktop shortcut on/off
;   - start with Windows on/off
; Registers the orbit:// invite-link protocol and cleans everything on uninstall.
; Silent installs (/S) skip the page and keep safe defaults (shortcut on, autostart off).

!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

; Declared at file scope: this file is included before the main script body,
; so Vars must live here (macro bodies expand later).
Var OrbitDlg
Var OrbitChkDesktop
Var OrbitChkAutostart
Var OrbitWantDesktop
Var OrbitWantAutostart

!macro customHeader
  Page custom OrbitOptionsShow OrbitOptionsLeave "Install options"
!macroend

Function OrbitOptionsShow
  nsDialogs::Create 1018
  Pop $OrbitDlg
  ${If} $OrbitDlg == "error"
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 28u "Choose extra options for your Orbit installation. You can change all of these later from inside the app."
  ; NB: NSD_CreateLabel pushes nothing, so no Pop here.
  ${NSD_CreateCheckbox} 0 36u 100% 12u "Create a &desktop shortcut"
  Pop $OrbitChkDesktop
  ${NSD_SetState} $OrbitChkDesktop 1
  ${NSD_CreateCheckbox} 0 54u 100% 12u "Start Orbit automatically when I sign in to &Windows"
  Pop $OrbitChkAutostart
  ${NSD_SetState} $OrbitChkAutostart 0
  nsDialogs::Show
FunctionEnd

Function OrbitOptionsLeave
  ${NSD_GetState} $OrbitChkDesktop $OrbitWantDesktop
  ${NSD_GetState} $OrbitChkAutostart $OrbitWantAutostart
FunctionEnd

!macro customInstall
  ; Desktop shortcut is created by default; remove it if the user opted out.
  ; (In silent installs the options page never shows, so $OrbitWantDesktop is
  ; empty and the shortcut is kept.)
  ${If} $OrbitWantDesktop == "0"
    Delete "$DESKTOP\Orbit.lnk"
  ${EndIf}

  ; orbit:// invite links, e.g. orbit://ab12-cd34 opens Orbit to join.
  WriteRegStr HKCU "Software\Classes\orbit" "" "URL:Orbit Invite Link"
  WriteRegStr HKCU "Software\Classes\orbit" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\orbit\DefaultIcon" "" "$INSTDIR\Orbit.exe,0"
  WriteRegStr HKCU "Software\Classes\orbit\shell\open\command" "" '"$INSTDIR\Orbit.exe" "%1"'

  ${If} $installMode == "AllUsers"
    WriteRegStr HKLM "Software\Classes\orbit" "" "URL:Orbit Invite Link"
    WriteRegStr HKLM "Software\Classes\orbit" "URL Protocol" ""
    WriteRegStr HKLM "Software\Classes\orbit\DefaultIcon" "" "$INSTDIR\Orbit.exe,0"
    WriteRegStr HKLM "Software\Classes\orbit\shell\open\command" "" '"$INSTDIR\Orbit.exe" "%1"'
    ${If} $OrbitWantAutostart == "1"
      WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Orbit" '"$INSTDIR\Orbit.exe" --autostart'
    ${EndIf}
  ${Else}
    ${If} $OrbitWantAutostart == "1"
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Orbit" '"$INSTDIR\Orbit.exe" --autostart'
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\orbit"
  DeleteRegKey HKLM "Software\Classes\orbit"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Orbit"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Orbit"
!macroend
