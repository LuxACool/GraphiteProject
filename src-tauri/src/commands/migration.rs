use super::super::repositories::migration::{self,MigrationBeginInput,MigrationStatus,MigrationVerifyReport};
use super::super::repositories::sync::DualWritePayload;
use tauri::AppHandle;
#[tauri::command] pub fn migration_status(app:AppHandle)->Result<MigrationStatus,String>{migration::status(&app)}
#[tauri::command] pub fn migration_begin(app:AppHandle,input:MigrationBeginInput)->Result<MigrationStatus,String>{migration::begin(&app,input)}
#[tauri::command] pub fn migration_import_and_verify(app:AppHandle,payload:DualWritePayload)->Result<MigrationVerifyReport,String>{migration::import_and_verify(&app,payload)}
#[tauri::command] pub fn migration_complete(app:AppHandle,run_id:String)->Result<MigrationStatus,String>{migration::complete(&app,&run_id)}
#[tauri::command] pub fn migration_fail(app:AppHandle,run_id:String,error:String)->Result<MigrationStatus,String>{migration::fail(&app,&run_id,&error)}
