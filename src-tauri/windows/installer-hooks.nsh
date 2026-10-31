; Installer hooks for the NSIS installer (tauri.conf.json:
; bundle.windows.nsis.installerHooks). Upgrades should take as few clicks as
; possible, so a double-clicked installer that finds an older Life OS:
;
;   1. removes an old MSI install of Life OS (releases up to 0.4.0 shipped an
;      MSI as well) without its "Are you sure?" dialog. Windows still asks
;      for administrator approval once, because that install is per-machine.
;   2. re-runs itself as a passive update (/P /UPDATE /R), the same path the
;      in-app updater uses: no pages, no uninstall step, the old install is
;      replaced in place and the app reopens.
;
; Fresh installs, reinstalling the same version and downgrades keep the
; normal wizard. Runs before the first page is drawn.
;
; This file is included before the template defines PRODUCTNAME and its own
; variables, so it uses only registers and repeats the product name.

!define LIFEOS_PRODUCT "Life OS"
!define LIFEOS_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LIFEOS_PRODUCT}"
!define LIFEOS_ALLUNINST "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"

!define MUI_CUSTOMFUNCTION_GUIINIT LifeOsQuickUpgrade

; Sets $R6 to the product code of an MSI install of Life OS, or "".
Function LifeOsFindMsi
  StrCpy $R6 ""
  StrCpy $0 0
  ${Do}
    EnumRegKey $1 HKLM "${LIFEOS_ALLUNINST}" $0
    ${If} $1 == ""
      ${Break}
    ${EndIf}
    IntOp $0 $0 + 1
    ReadRegStr $2 HKLM "${LIFEOS_ALLUNINST}\$1" "DisplayName"
    ${If} $2 == "${LIFEOS_PRODUCT}"
      ReadRegDWORD $3 HKLM "${LIFEOS_ALLUNINST}\$1" "WindowsInstaller"
      ${If} $3 = 1
        StrCpy $R6 $1
        ${Break}
      ${EndIf}
    ${EndIf}
  ${Loop}
FunctionEnd

Function LifeOsQuickUpgrade
  ; Already passive (in-app updater, or the re-run below) or silent: nothing to do.
  ${If} ${Silent}
    Return
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    Return
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${IfNot} ${Errors}
    Return
  ${EndIf}

  ; This installer's version, from its own version resource (major.minor.patch).
  ClearErrors
  GetDLLVersion "$EXEPATH" $R0 $R1
  ${If} ${Errors}
    Return
  ${EndIf}
  IntOp $R2 $R0 >> 16
  IntOp $R3 $R0 & 0xFFFF
  IntOp $R4 $R1 >> 16
  StrCpy $R9 "$R2.$R3.$R4"

  ; 1. An MSI install: remove it quietly (progress bar only, no confirmation).
  Call LifeOsFindMsi
  ${If} $R6 != ""
    ReadRegStr $R5 HKLM "${LIFEOS_ALLUNINST}\$R6" "DisplayVersion"
    ${VersionCompare} $R9 $R5 $0
    ; A newer MSI install: leave the choice to the wizard.
    ${If} $0 = 2
      Return
    ${EndIf}
    ClearErrors
    ExecWait '"$SYSDIR\msiexec.exe" /x $R6 /passive /norestart' $0
    ${If} ${Errors}
      Return
    ${EndIf}
    ; 0 removed, 3010 removed (restart pending), 1605 already gone. Anything
    ; else (1602 cancelled, approval refused): fall back to the wizard.
    ${If} $0 <> 0
    ${AndIf} $0 <> 3010
    ${AndIf} $0 <> 1605
      Return
    ${EndIf}
  ${EndIf}

  ; 2. An older install from this installer: update it in place.
  StrCpy $R8 ""
  ReadRegStr $R5 SHCTX "${LIFEOS_UNINSTKEY}" "DisplayVersion"
  ${If} $R5 != ""
    ${VersionCompare} $R9 $R5 $0
    ; Same or newer version installed: show the wizard (repair or uninstall).
    ${If} $0 <> 1
      Return
    ${EndIf}
    StrCpy $R8 " /UPDATE"
  ${ElseIf} $R6 == ""
    ; Nothing installed: a first install keeps the normal wizard.
    Return
  ${EndIf}

  Exec '"$EXEPATH" /P /R$R8'
  Quit
FunctionEnd
