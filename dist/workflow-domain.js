((root)=>{
  const participantIds=(type,leader,others=[])=>{
    const ids=[String(leader||'').trim(),...others.map(value=>String(value||'').trim())].filter(Boolean);
    const unique=[...new Set(ids)];
    if(!['individu','tim'].includes(type)||!unique.length)throw new Error('Pilih nama anggota dari daftar CSSMoRA.');
    if(type==='individu'&&unique.length!==1)throw new Error('Prestasi individu hanya memiliki satu anggota.');
    if(type==='tim'&&unique.length<2)throw new Error('Pilih minimal dua anggota untuk capaian tim.');
    return unique;
  };
  const domain=Object.freeze({participantIds});
  if(typeof module!=='undefined'&&module.exports)module.exports=domain;
  if(root)root.CSSMoRADomain=domain;
})(typeof window!=='undefined'?window:globalThis);
