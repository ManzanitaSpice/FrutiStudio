import { invoke } from "@tauri-apps/api/core";

export const selectFolder = async () => invoke<string>("select_folder");
