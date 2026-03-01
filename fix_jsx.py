file_path = r"c:\Users\abush\OneDrive\Desktop\mithran\components\features\process-planning\ProcessCostDialog.tsx"

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Lines 1317-1322 (0-indexed: 1316-1321) need to be replaced
# Current (broken):
#   1317:               </table>
#   1318:             </div>
#   1319:           </div>
#   1320:         </>        <-- Fragment close, but outer <div> at line 1180 was never closed!
#   1321:         );
#   1322:       })()}
#
# Fixed:
#   1317:               </table>
#   1318:             </div>
#   1319:           </div>
#   1320:         </div>  <-- close the outer lookup panel <div>
#   1321:           </>
#   1322:         );
#   1323:       })()}

new_ending = [
    '              </table>\r\n',
    '            </div>\r\n',
    '          </div>\r\n',
    '            </div>  {/* end lookup panel outer div */}\r\n',
    '          </>\r\n',
    '        );\r\n',
    '      })()}\r\n',
]

# Replace lines 1316..1321 (0-indexed)
before = lines[:1316]
after  = lines[1322:]
result = before + new_ending + after

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(result)

print(f"Done. Total lines: {len(result)}")
# Print surrounding lines to verify
for i, line in enumerate(result[1312:1325], start=1313):
    print(f"{i}: {line}", end='')
