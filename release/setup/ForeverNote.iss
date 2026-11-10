; Instalador do ForeverNote (Inno Setup 6) - montado pelo GitHub Actions
; ISCC /DAppVer=2.9.5 /DSrcDir=<pasta ForeverNote> /DOutDir=<saida> ForeverNote.iss

#ifndef AppVer
  #define AppVer "0.0.0"
#endif
#define AppId "{{8E3A5C2B-6F1D-4B7A-9C3E-2D5F7A1B9C40}"
#define AppUMID "com.forevernote.app"

[Setup]
AppId={#AppId}
AppName=ForeverNote
AppVersion={#AppVer}
AppVerName=ForeverNote {#AppVer}
AppPublisher=revmpt
AppPublisherURL=https://github.com/DaviGerhardt/ForeverNote
AppSupportURL=https://github.com/DaviGerhardt/ForeverNote
AppUpdatesURL=https://github.com/DaviGerhardt/ForeverNote/releases
AppCopyright=by revmpt
VersionInfoVersion={#AppVer}
VersionInfoProductName=ForeverNote
VersionInfoDescription=Instalador do ForeverNote
VersionInfoCompany=revmpt
; instalado na pasta do usuário: não pede administrador e as atualizações automáticas conseguem gravar
DefaultDirName={localappdata}\Programs\ForeverNote
PrivilegesRequired=lowest
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
ShowLanguageDialog=no
UsePreviousTasks=yes
CloseApplications=no
OutputDir={#OutDir}
OutputBaseFilename=ForeverNote-Setup-v{#AppVer}
SetupIconFile=..\..\app\build\icon.ico
UninstallDisplayIcon={app}\ForeverNote.exe
UninstallDisplayName=ForeverNote
WizardStyle=modern
WizardSizePercent=100
WizardImageFile=wizard-164.bmp,wizard-205.bmp,wizard-246.bmp,wizard-287.bmp,wizard-328.bmp,wizard-410.bmp
WizardSmallImageFile=small-55.bmp,small-69.bmp,small-82.bmp,small-96.bmp,small-110.bmp,small-138.bmp
WizardImageStretch=yes
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Messages]
pt.SetupWindowTitle=Instalar o ForeverNote
pt.WelcomeLabel1=Bem-vindo ao ForeverNote
pt.WelcomeLabel2=Vamos instalar o ForeverNote {#AppVer} no seu computador.%n%nNotas, roteiros, tarefas e moodboards, sincronizados com o celular.%n%nSe você já usa o app, suas notas continuam exatamente onde estão.
pt.SelectTasksLabel2=Escolha os atalhos e clique em Instalar.
pt.ButtonNext=&Avançar >
pt.FinishedHeadingLabel=Tudo pronto!
pt.FinishedLabel=O ForeverNote foi instalado.%n%nEle se atualiza sozinho sempre que sair uma versão nova.
pt.FinishedLabelNoIcons=O ForeverNote foi instalado.%n%nEle se atualiza sozinho sempre que sair uma versão nova.
pt.ConfirmUninstall=Remover o ForeverNote deste computador?%n%nSuas notas NÃO são apagadas: elas continuam em Documentos\ForeverNote (e na nuvem, se a sincronização estiver ligada).
pt.UninstalledAll=O ForeverNote foi removido.%n%nSuas notas continuam em Documentos\ForeverNote.

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"

[InstallDelete]
; o app inteiro é reinstalado (remove arquivos de versões antigas)
Type: filesandordirs; Name: "{app}\resources\app"

[Files]
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\ForeverNote"; Filename: "{app}\ForeverNote.exe"; WorkingDir: "{app}"; Comment: "Notas, roteiros e moodboards"; AppUserModelID: "{#AppUMID}"
Name: "{autodesktop}\ForeverNote"; Filename: "{app}\ForeverNote.exe"; WorkingDir: "{app}"; Comment: "Notas, roteiros e moodboards"; AppUserModelID: "{#AppUMID}"; Tasks: desktopicon

[Run]
Filename: "{app}\ForeverNote.exe"; Description: "Abrir o ForeverNote agora"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
procedure FecharApp();
var R: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/im ForeverNote.exe /f', '', SW_HIDE, ewWaitUntilTerminated, R);
  Sleep(700);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  FecharApp();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  FecharApp();
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var K: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    { tira o "abrir com o Windows", se estava ligado }
    K := 'Software\Microsoft\Windows\CurrentVersion\Run';
    RegDeleteValue(HKCU, K, '{#AppUMID}');
    RegDeleteValue(HKCU, K, 'ForeverNote');
    RegDeleteValue(HKCU, K, 'electron.app.ForeverNote');
    { atalhos antigos criados pelo próprio app (instalação pelo .bat) }
    DeleteFile(ExpandConstant('{userdesktop}\ForeverNote.lnk'));
    DeleteFile(ExpandConstant('{userprograms}\ForeverNote.lnk'));
  end;
end;
