; ---------------------------------------------------------------------------
; customInit — runs in .onInit, BEFORE electron-builder tries to uninstall any
; previous version.
;
; Why this exists: the installer's normal upgrade path runs the OLD version's
; uninstaller first. If that uninstaller is damaged — which happens when the
; original download was corrupted in transfer, and is invisible until the day
; you upgrade — it aborts with "installer integrity check has failed" and the
; new version can NEVER be installed. The clinic is then stuck on a broken
; version with no way forward except editing the registry by hand.
;
; So we retire the old registration ourselves and let this installer simply
; overwrite the program folder. An Electron app replaces its install directory
; wholesale, so nothing is gained by running the old uninstaller anyway.
;
; This touches ONLY the Windows uninstall registration and the program folder
; under Program Files. It never goes near %APPDATA%\CureDesk HMS\, where the
; patient database, settings and backups live.
; ---------------------------------------------------------------------------
; NOTE ON THE KEY NAME: the uninstall entry is NOT named after the appId.
; electron-builder derives a UUID-v5 from it (com.curedesk.hms becomes
; 830b29be-469c-5d72-a840-4d0d3026568e), so deleting a key named after the
; appId silently removes nothing and the damaged uninstaller still runs.
; Use electron-builder's own compile-time defines instead of spelling the key
; out — they are by definition the exact keys uninstallOldVersion will read,
; and they keep working if the appId or guid ever changes.
!macro customInit
  ; ── Close any running CureDesk BEFORE we touch its files ──────────────────
  ; Our customInit skips the normal uninstaller path (a damaged uninstaller was
  ; blocking upgrades), but that path is ALSO where electron-builder would
  ; normally stop the running app. Skipping it meant the installer replaced the
  ; program files underneath a live 0.6.0 process: that process kept its LAN
  ; socket open but could no longer serve — the whole clinic saw "network down"
  ; and it never recovered on its own. So we must stop it ourselves.
  ;
  ; Graceful first: taskkill WITHOUT /F posts WM_CLOSE, which fires Electron's
  ; before-quit and lets better-sqlite3 close the database cleanly. Then /F as a
  ; backstop for a process that is already wedged and cannot answer WM_CLOSE
  ; (exactly the state we are trying to cure), so the file locks are released
  ; and the new files can be written. /T also takes the out-of-process watchdog.
  DetailPrint "Closing CureDesk if it is running..."
  nsExec::Exec 'taskkill /IM "CureDesk HMS.exe"'
  Sleep 2500
  nsExec::Exec 'taskkill /F /T /IM "CureDesk HMS.exe"'
  Sleep 1200

  ; Both hives and both views — a per-machine install writes HKLM, an older
  ; per-user one writes HKCU, and 32/64-bit views keep separate copies.
  SetRegView 64
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  SetRegView 32
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  SetRegView lastused

  ; The legacy GUID-named key, defined only when it differs from the one above.
  !ifdef UNINSTALL_REGISTRY_KEY_2
    SetRegView 64
    DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY_2}"
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
    SetRegView 32
    DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY_2}"
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
    SetRegView lastused
  !endif

  ; Remove a damaged uninstaller so nothing can try to run it later.
  Delete "$PROGRAMFILES64\CureDesk HMS\Uninstall CureDesk HMS.exe"
  Delete "$PROGRAMFILES32\CureDesk HMS\Uninstall CureDesk HMS.exe"
  Delete "$LOCALAPPDATA\Programs\CureDesk HMS\Uninstall CureDesk HMS.exe"
!macroend

; Custom NSIS hooks for CureDesk HMS.
; electron-builder runs `customUnInstall` near the end of the uninstall flow
; (after the program files are gone, before the uninstaller exits).
;
; We add a Yes/No prompt asking the user whether to also wipe %APPDATA%\CureDesk HMS\
; — that folder holds the SQLite database, settings, backups, and the
; localStorage flags that suppress the welcome wizard. Saying YES gives a
; truly fresh install on next launch; saying NO preserves all data so the
; uninstall behaves as an "upgrade".

!macro customUnInstall
  ; Only show the prompt if the AppData folder actually exists.
  IfFileExists "$APPDATA\CureDesk HMS\*.*" 0 curedesk_clean_done

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Also delete ALL clinic data?$\n$\n\
     This will permanently remove:$\n\
       • Patient records$\n\
       • Doctors, bills, prescriptions$\n\
       • Settings, audit logs, backups$\n$\n\
     Choose NO to keep your data (recommended for upgrades).$\n\
     Choose YES only for a truly fresh install." \
    /SD IDNO IDNO curedesk_clean_done

  DetailPrint "Removing CureDesk HMS clinic data folder..."
  RMDir /r "$APPDATA\CureDesk HMS"

  curedesk_clean_done:
!macroend
