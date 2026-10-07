; QANDEEL COMPANY - Desktop v1 Setup (D1, D-D1-01 ... D-D1-06). Compiled ONLY by packaging/windows/build.mjs, which
; passes the composed, verified bundle and its identity as defines. Inno Setup is an orchestration shell: it lays the
; versioned application files down side by side and hands every Company operation to the bundle's own release code
; (`desktop-install` / `desktop-uninstall`) running on the bundle's private Node runtime. It never writes Company data,
; the vault, the releases, the production pin or the launcher configuration, never needs elevation, never changes PATH,
; never registers autostart, and never offers to delete the Company.
;
; Required defines: AppVersion, AppGuid, Publisher, BundleDir, VersionDir, BundleId, ReleaseId, SourceCommit, IconFile.
; Optional: Signed (with /Sqandeelsign=... - the signing seam; the credential never lives in the repository).

#define AppName "QANDEEL COMPANY"
#ifndef AppVersion
  #error AppVersion is required (build through packaging/windows/build.mjs)
#endif
#ifndef BundleDir
  #error BundleDir is required (build through packaging/windows/build.mjs)
#endif
#define BundleCliRel "release\node_modules\@qandeel-company\command-center\dist\src\cli.js"

[Setup]
AppId={{{#AppGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#Publisher}
AppComments=Desktop bundle {#BundleId}; release {#ReleaseId}; source {#SourceCommit}
VersionInfoVersion={#AppVersion}.0
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoDescription={#AppName} Setup
VersionInfoCompany={#Publisher}
; Per-user, no elevation: {autopf} is %LOCALAPPDATA%\Programs for a per-user install.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=QANDEEL-COMPANY-Setup
SetupIconFile={#IconFile}
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\versions\{#VersionDir}\app\qandeel-company.ico
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
; The Company host is stopped by the canonical controlled stop, never by the Restart Manager.
CloseApplications=no
RestartApplications=no
ChangesEnvironment=no
ChangesAssociations=no
SetupLogging=yes
#ifdef Signed
SignTool=qandeelsign
SignedUninstaller=yes
#endif

[Files]
; One versioned directory per bundle: an update never overwrites the runtime that is hosting the Company.
Source: "{#BundleDir}\*"; DestDir: "{app}\versions\{#VersionDir}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
; Opens the Company through the Desktop shortcut desktop-install just wrote (interactive installs only).
Filename: "{userdesktop}\{#AppName}.lnk"; Description: "Open {#AppName}"; Flags: postinstall nowait skipifsilent shellexec unchecked; Check: InstallSucceeded

[Messages]
SetupAppTitle=Setup - {#AppName}
SetupWindowTitle=Setup - {#AppName} {#AppVersion}

[Code]
var
  WorkspacePage: TInputDirWizardPage;
  InstallResult: Integer;

function VersionDir(): String;
begin
  Result := ExpandConstant('{app}\versions\{#VersionDir}');
end;

function NodeExe(): String;
begin
  Result := VersionDir() + '\node\node.exe';
end;

function BundleCli(): String;
begin
  Result := VersionDir() + '\{#BundleCliRel}';
end;

function HasLauncherConfig(): Boolean;
begin
  Result := FileExists(ExpandConstant('{localappdata}\QANDEEL_COMPANY\launcher\founder-launcher.json'));
end;

function InstallSucceeded(): Boolean;
begin
  Result := InstallResult = 0;
end;

procedure InitializeWizard();
begin
  InstallResult := -1;
  WorkspacePage := CreateInputDirPage(wpWelcome,
    'Your existing Company',
    'Choose the folder of your existing QANDEEL COMPANY workspace.',
    'QANDEEL COMPANY installs the application for your EXISTING Company. Setup never creates a new Company, ' +
    'a new CEO or a new database. Select the folder that holds your Company workspace, then click Next.',
    False, '');
  WorkspacePage.Add('');
  WorkspacePage.Values[0] := ExpandConstant('{param:workspace|}');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = WorkspacePage.ID) and HasLauncherConfig();
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Rc: Integer;
begin
  Result := '';
  // Repair of this exact version: its private runtime may be hosting the Company. Controlled stop before its files
  // are restored (desktop-install restarts it). An update installs into a new directory and needs no stop here.
  if FileExists(NodeExe()) and FileExists(BundleCli()) then
    Exec(NodeExe(), '"' + BundleCli() + '" stop', '', SW_HIDE, ewWaitUntilTerminated, Rc);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Params, Chosen: String;
  Rc: Integer;
begin
  if CurStep <> ssPostInstall then Exit;
  Params := '"' + BundleCli() + '" desktop-install --bundle "' + VersionDir() + '"';
  Chosen := WorkspacePage.Values[0];
  if (not HasLauncherConfig()) and (Chosen <> '') then
    Params := Params + ' --workspace "' + Chosen + '"';
  if not Exec(NodeExe(), Params, '', SW_HIDE, ewWaitUntilTerminated, Rc) then Rc := 1;
  InstallResult := Rc;
  Log('QANDEEL COMPANY desktop-install exit code: ' + IntToStr(Rc));
  if Rc = 2 then
    SuppressibleMsgBox('QANDEEL COMPANY is installed, but no existing Company was chosen.' + #13#10#13#10 +
      'Nothing was created. Run Setup again and choose the folder of your existing Company workspace.',
      mbInformation, MB_OK, IDOK)
  else if Rc <> 0 then
    SuppressibleMsgBox('QANDEEL COMPANY could not be activated (exit code ' + IntToStr(Rc) + ').' + #13#10#13#10 +
      'Your Company data is unchanged. The previously active version keeps running where it was running.',
      mbError, MB_OK, IDOK);
end;

function GetCustomSetupExitCode(): Integer;
begin
  if InstallResult <= 0 then Result := 0 else Result := 100 + InstallResult;
end;

function InitializeUninstall(): Boolean;
var
  Rc: Integer;
begin
  Result := True;
  // The application only: a controlled stop of the host and the shortcuts. Company data is never touched.
  if FileExists(NodeExe()) and FileExists(BundleCli()) then
  begin
    if not Exec(NodeExe(), '"' + BundleCli() + '" desktop-uninstall', '', SW_HIDE, ewWaitUntilTerminated, Rc) then Rc := 1;
    Log('QANDEEL COMPANY desktop-uninstall exit code: ' + IntToStr(Rc));
    if Rc <> 0 then
    begin
      SuppressibleMsgBox('QANDEEL COMPANY could not be stopped safely, so nothing was uninstalled.' + #13#10 +
        'Use Start > QANDEEL COMPANY > Stop, then uninstall again. Your Company data is unchanged.', mbError, MB_OK, IDOK);
      Result := False;
    end;
  end;
end;
