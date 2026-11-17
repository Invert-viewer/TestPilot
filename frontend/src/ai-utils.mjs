export function csvForRows(fields, rows) {
  const quote=value=>{let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  return '\uFEFF'+[fields.map(quote).join(','),...rows.map(row=>fields.map(field=>quote(row[field])).join(','))].join('\r\n');
}
export function aiSettingsRoute(){return '#/settings?tab=ai';}
