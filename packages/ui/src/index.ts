export { AppShell } from "./components/AppShell";
export { ConfirmDialog } from "./components/ConfirmDialog";
export { EditorPane } from "./components/EditorPane";
export { Sidebar } from "./components/Sidebar";
export { StatusBar } from "./components/StatusBar";
export { TitleBar } from "./components/TitleBar";
export { Toast } from "./components/Toast";

export { useHotkeys, useTypographyVariables, useWindowTitle } from "./hooks/useAppHooks";

export { useT } from "./hooks/useT";

export { confirmAction, useDialog, type ConfirmOptions, type DialogAnswer } from "./dialog";

export {
  handleCloseDocument,
  handleNewDocument,
  handleOpenFile,
  handleOpenFolder,
  handleOpenPath,
  handleRefreshWorkspace,
  handleReloadFromDisk,
  handleSave,
  handleSaveAs,
  toggleSidebar,
  toggleTheme,
  updateContent,
} from "./actions";
