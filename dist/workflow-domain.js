((root)=>{
  const createJournal=(direction,amount,cashCode,categoryCode)=>{
    const value=Number(amount),cash=String(cashCode||'').trim(),category=String(categoryCode||'').trim();
    if(!['income','expense'].includes(direction)||!Number.isSafeInteger(value)||value<=0)throw new Error('Nominal jurnal tidak valid.');
    if(!cash||!category||cash===category)throw new Error('Pilih dua kode akun yang berbeda.');
    const debitAccount=direction==='income'?cash:category,creditAccount=direction==='income'?category:cash;
    const lines=[{account_code:debitAccount,debit:value,credit:0},{account_code:creditAccount,debit:0,credit:value}];
    if(lines.reduce((sum,line)=>sum+line.debit,0)!==lines.reduce((sum,line)=>sum+line.credit,0))throw new Error('Jurnal tidak seimbang.');
    return lines;
  };
  const budgetComparison=(planned,forecast,transactions,budgetId)=>{
    const actual=(transactions||[]).filter(row=>row.budget_id===budgetId&&row.direction==='expense').reduce((sum,row)=>sum+Number(row.amount||0),0);
    const plan=Number(planned)||0,projection=Number(forecast)||0;
    return {actual,variance:actual-plan,forecastVariance:projection-plan,remaining:plan-actual};
  };
  const participantIds=(type,leader,others=[])=>{
    const ids=[String(leader||'').trim(),...others.map(value=>String(value||'').trim())].filter(Boolean);
    const unique=[...new Set(ids)];
    if(!['individu','tim'].includes(type)||!unique.length)throw new Error('Pilih nama anggota dari daftar CSSMoRA.');
    if(type==='individu'&&unique.length!==1)throw new Error('Prestasi individu hanya memiliki satu anggota.');
    if(type==='tim'&&unique.length<2)throw new Error('Pilih minimal dua anggota untuk capaian tim.');
    return unique;
  };
  const domain=Object.freeze({createJournal,budgetComparison,participantIds});
  if(typeof module!=='undefined'&&module.exports)module.exports=domain;
  if(root)root.CSSMoRADomain=domain;
})(typeof window!=='undefined'?window:globalThis);
