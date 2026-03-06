const ipaddr = require('ipaddr.js');
function parseCIDR(cidr){ const parts = String(cidr).split('/'); return [ipaddr.parse(parts[0]), parseInt(parts[1],10)]; }
function isInCidrs(ip, cidrs){
  if(!ip) return false;
  let obj; try{ obj=ipaddr.parse(ip);}catch{return false;}
  return (cidrs||[]).some(c=>{ try{ const [n,p]=parseCIDR(c); return obj.match([n,p]); }catch{return false;} });
}
module.exports = { isInCidrs };
