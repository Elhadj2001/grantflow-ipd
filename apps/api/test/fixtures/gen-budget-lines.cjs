const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const rows = [
  { code: 'L02', label: 'Personnel scientifique', budgeted_amount: 120000, default_account: null, is_overhead_eligible: true },
  { code: 'L03', label: 'Equipement laboratoire', budgeted_amount: 80000, default_account: null, is_overhead_eligible: true },
  { code: 'L04', label: 'Voyages internationaux', budgeted_amount: 25000, default_account: null, is_overhead_eligible: true },
  { code: 'L05', label: 'Formation et ateliers', budgeted_amount: 40000, default_account: null, is_overhead_eligible: true },
  { code: 'L06', label: 'Coordination scientifique', budgeted_amount: 30000, default_account: null, is_overhead_eligible: true },
];

const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
const out = path.resolve(__dirname, 'budget-lines-sample.xlsx');
XLSX.writeFile(wb, out);
console.log('wrote', out);
