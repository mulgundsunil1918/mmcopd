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
