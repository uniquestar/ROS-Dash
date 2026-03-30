/* ROS-Dash v0.5.0 */
'use strict';
var socket = io();

// ── Utilities ──────────────────────────────────────────────────────────────
var DOT = '\u00b7';
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function fmtMbps(v){var n=+v||0;if(n>=1000)return(n/1000).toFixed(2)+' Gbps';if(n>=1)return n.toFixed(2)+' Mbps';return(n*1000).toFixed(1)+' Kbps';}
function fmtBytes(b){if(b>=1073741824)return(b/1073741824).toFixed(1)+' GB';if(b>=1048576)return(b/1048576).toFixed(1)+' MB';if(b>=1024)return(b/1024).toFixed(1)+' KB';return b+' B';}
function signalBars(dbm){var bars=dbm>=-55?4:dbm>=-65?3:dbm>=-75?2:dbm>-85?1:0;var h='<span class="signal-bars">';for(var i=1;i<=4;i++)h+='<span'+(i<=bars?' class="lit"':'')+'>&#8203;</span>';return h+'</span>';}
function actionBadge(a){var c='secondary';if(a==='accept'||a==='passthrough')c='success';else if(a==='drop'||a==='reject'||a==='tarpit')c='danger';else if(a==='log'||a==='add-src-to-address-list')c='warning';else if(a==='masquerade'||a==='dst-nat'||a==='src-nat')c='info';return'<span class="badge bg-'+c+'" style="font-family:var(--font-mono);font-size:.63rem;color:#000">'+esc(a)+'</span>';}
function parseTxRate(raw){if(!raw)return'—';var s=String(raw).trim();var m=s.match(/^([\d.]+)\s*(G|Gbps|M|Mbps|K|Kbps|k)\b/i);if(m){var val=parseFloat(m[1]),unit=m[2].toLowerCase(),mbps;if(unit==='g'||unit==='gbps')mbps=val*1000;else if(unit==='k'||unit==='kbps')mbps=val/1000;else mbps=val;return(Number.isInteger(mbps)?mbps:+mbps.toFixed(1))+' Mbps';}if(/^\d+$/.test(s)){var bps=parseInt(s,10);var mbps2=bps/1e6;return(Number.isInteger(mbps2)?mbps2:+mbps2.toFixed(1))+' Mbps';}return s;}
function parseUptime(raw){var s=String(raw||''),parts=[];var w=(s.match(/(\d+)w/)||[0,0])[1],d=(s.match(/(\d+)d/)||[0,0])[1];var h=(s.match(/(\d+)h/)||[0,0])[1],m=(s.match(/(\d+)m/)||[0,0])[1];if(+w)parts.push(w+'w');if(+d)parts.push(d+'d');if(+h)parts.push(h+'h');if(+m)parts.push(m+'m');return parts.length?parts.join(' '):(raw||'—');}

// ── DOM refs ───────────────────────────────────────────────────────────────
var $ = function(id){return document.getElementById(id);};
var reconnectBanner  = $('reconnectBanner');
var ifaceSelect      = $('ifaceSelect');
var wanStatusBadge   = $('wanStatusBadge');
var liveRx           = $('liveRx');
var liveTx           = $('liveTx');
var lanOverview      = $('lanOverview');
var wanIpDisplay     = $('wanIpDisplay');
var topSources       = $('topSources');
var topDests         = $('topDests');
var connTotal        = $('connTotal');
var protoBars        = $('protoBars');
var talkersTable     = $('talkersTable');
var logsEl           = $('logs');
var logSearch        = $('logSearch');
var logSeverity      = $('logSeverity');
var toggleScroll     = $('toggleScroll');
var clearLogs        = $('clearLogs');
var gaugeRow         = $('gaugeRow');
var sysMeta          = $('sysMeta');
var rosUpdateRow     = $('rosUpdateRow');
var uptimeDisplay    = $('uptimeDisplay');
var uptimeChip       = $('uptimeChip');
var wirelessTable    = $('wirelessTable');
var wirelessTabBadge = $('wirelessTabBadge');
var wirelessNavBadge = $('wirelessNavBadge');
var vpnTable         = $('vpnTable');
var vpnCount         = $('vpnCount');
var firewallTable    = $('firewallTable');
var routerTag        = $('routerTag');
var pageTitle        = $('pageTitle');
var ifaceGrid        = $('ifaceGrid');
var dhcpTable        = $('dhcpTable');
var dhcpCanWrite     = false;
var switchCanWrite   = false;
var dhcpTotalBadge   = $('dhcpTotalBadge');
var dhcpNavBadge     = $('dhcpNavBadge');
var dhcpSearch       = $('dhcpSearch');

// ── State ──────────────────────────────────────────────────────────────────
var autoScroll = true, logFilter = '', logLevel = '';
var currentIf = '', windowSecs = 60;
var fwTab = 'top', fwData = {};
var connHistory = [], MAX_CONN_HIST = 60;
var lastTalkers = null, lastLanData = null;
var allLeases = [], leaseFilter = '';

// ── Theme toggle ───────────────────────────────────────────────────────────
var THEME_KEY = 'rosdash_theme';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.setAttribute('data-bs-theme', t === 'light' ? 'light' : 'dark');
  var p = $('themeIconPath');
  if(p) p.setAttribute('d', t==='light'
    ? 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'
    : 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
  try{localStorage.setItem(THEME_KEY, t);}catch(e){}
}
(function(){
  var saved='dark';
  try{saved=localStorage.getItem(THEME_KEY)||'dark';}catch(e){}
  applyTheme(saved);
})();
var themeToggle = $('themeToggle');
if(themeToggle) themeToggle.addEventListener('click', function(){
  var cur = document.documentElement.getAttribute('data-theme')||'dark';
  applyTheme(cur==='light'?'dark':'light');
});

// ── CSRF Protection ───────────────────────────────────────────────────────
var csrfToken = null;
function getCsrfToken() {
  return new Promise(function(resolve) {
    if (csrfToken) {
      resolve(csrfToken);
      return;
    }
    fetch('/api/csrf-token', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        csrfToken = data.csrfToken;
        resolve(csrfToken);
      })
      .catch(function(err) {
        console.error('Failed to get CSRF token:', err);
        resolve(null);
      });
  });
}

// Enhanced fetch that adds CSRF token for non-GET requests
function secureApiCall(url, options) {
  options = options || {};
  var method = (options.method || 'GET').toUpperCase();
  
  if (method === 'GET' || method === 'HEAD') {
    return fetch(url, options);
  }
  
  return getCsrfToken().then(function(token) {
    var headers = options.headers || {};
    if (token) {
      headers['X-CSRF-Token'] = token;
    }
    return fetch(url, Object.assign({}, options, { headers: headers }));
  });
}

// ── Page router ────────────────────────────────────────────────────────────
var PAGE_TITLES = {dashboard:'Dashboard',connections:'Connections',wireless:'Wireless',interfaces:'Interfaces',dhcp:'DHCP',firewall:'Firewall',vpn:'VPN',logs:'Logs',users:'User Management'};
var PAGE_KEYS   = ['dashboard','wireless','interfaces','dhcp','vpn','connections','firewall','logs','info','users'];
function showPage(name){
  document.querySelectorAll('.page-view').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  var page = $('page-'+name); if(page) page.classList.add('active');
  var nav  = document.querySelector('.nav-item[data-page="'+name+'"]'); if(nav) nav.classList.add('active');
  if(pageTitle) pageTitle.textContent = PAGE_TITLES[name]||name;
  if(name === 'users' && typeof loadUsers === 'function') loadUsers();
}
document.querySelectorAll('.nav-item').forEach(function(item){
  item.addEventListener('click', function(e){
  if(item.dataset.page) { e.preventDefault(); showPage(item.dataset.page); }
});
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
var kbdHint = $('kbdHint');
var kbdTimer = null;
function showKbdHint(){
  if(!kbdHint) return;
  kbdHint.classList.add('show');
  clearTimeout(kbdTimer);
  kbdTimer = setTimeout(function(){kbdHint.classList.remove('show');}, 1800);
}
document.addEventListener('keydown', function(e){
  if(e.target && (e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA')) return;
  if(e.key==='/'){ e.preventDefault(); showPage('logs'); setTimeout(function(){if(logSearch)logSearch.focus();},100); showKbdHint(); return;}
  var n = parseInt(e.key);
  if(n>=1&&n<=PAGE_KEYS.length){ showPage(PAGE_KEYS[n-1]); showKbdHint(); }
});

// ── Firewall sub-tabs ──────────────────────────────────────────────────────
document.querySelectorAll('.fw-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    document.querySelectorAll('.fw-tab').forEach(function(t){t.classList.remove('active');});
    tab.classList.add('active'); fwTab = tab.dataset.fw; renderFirewallTab();
  });
});


// ── Traffic Chart ──────────────────────────────────────────────────────────
var trafficCtx = $('trafficChart');
var chart = null;
var allPoints = [];
var MAX_CLIENT_POINTS = 3600;

function windowedPoints(){
  var cutoff = Date.now()-(windowSecs*1000), out=[];
  for(var i=allPoints.length-1;i>=0;i--){if(allPoints[i].ts<cutoff)break;out.unshift(allPoints[i]);}
  return out;
}
function makeChartObj(){
  if(chart){chart.destroy();chart=null;}
  chart=new Chart(trafficCtx,{type:'line',data:{labels:[],datasets:[
    {label:'RX',data:[],borderColor:'#38bdf8',backgroundColor:'rgba(56,189,248,.08)',borderWidth:1.5,tension:0.3,pointRadius:0,fill:true},
    {label:'TX',data:[],borderColor:'#34d399',backgroundColor:'rgba(52,211,153,.06)',borderWidth:1.5,tension:0.3,pointRadius:0,fill:true}
  ]},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(7,9,15,.9)',borderColor:'rgba(99,130,190,.2)',borderWidth:1,
      titleFont:{family:"'JetBrains Mono',monospace",size:11},bodyFont:{family:"'JetBrains Mono',monospace",size:11},
      callbacks:{label:function(ctx){return' '+ctx.dataset.label+': '+fmtMbps(ctx.parsed.y);}}}},
    scales:{x:{display:true,grid:{color:'rgba(99,130,190,.07)'},ticks:{color:'rgba(148,163,190,.4)',font:{family:"'JetBrains Mono',monospace",size:10},maxTicksLimit:8,maxRotation:0}},
            y:{beginAtZero:true,grid:{color:'rgba(99,130,190,.07)'},ticks:{color:'rgba(148,163,190,.4)',font:{family:"'JetBrains Mono',monospace",size:10},callback:function(v){return fmtMbps(v);}}}}}});
}
function redrawChart(){
  var pts=windowedPoints(); if(!chart)makeChartObj();
  chart.data.labels=pts.map(function(p){return new Date(p.ts).toLocaleTimeString();});
  chart.data.datasets[0].data=pts.map(function(p){return p.rx_mbps;});
  chart.data.datasets[1].data=pts.map(function(p){return p.tx_mbps;});
  chart.update('none');
}
function pushChartPoint(p){
  allPoints.push({ts:p.ts,rx_mbps:p.rx_mbps,tx_mbps:p.tx_mbps});
  if(allPoints.length>MAX_CLIENT_POINTS)allPoints.shift();
  liveRx.textContent=fmtMbps(p.rx_mbps); liveTx.textContent=fmtMbps(p.tx_mbps);
  var cutoff=Date.now()-(windowSecs*1000); if(p.ts<cutoff)return;
  if(!chart)makeChartObj();
  var lbl=chart.data.labels,rx=chart.data.datasets[0].data,tx=chart.data.datasets[1].data;
  while(lbl.length>0&&allPoints[allPoints.length-lbl.length].ts<cutoff){lbl.shift();rx.shift();tx.shift();}
  lbl.push(new Date(p.ts).toLocaleTimeString()); rx.push(p.rx_mbps); tx.push(p.tx_mbps);
  chart.update('none');
}
function applyWindow(secs){windowSecs=secs;redrawChart();}
function initChart(points){allPoints=(points||[]).slice(-MAX_CLIENT_POINTS);if(!chart)makeChartObj();redrawChart();}

// ── WAN ────────────────────────────────────────────────────────────────────
function renderWanStatus(s){
  wanStatusBadge.className='wan-badge';
  if(s.disabled){wanStatusBadge.className+=' wan-disabled';wanStatusBadge.textContent=(s.ifName||'?')+' · disabled';}
  else if(s.running){wanStatusBadge.className+=' wan-up';wanStatusBadge.textContent=(s.ifName||'?')+' · up';}
  else{wanStatusBadge.className+=' wan-down';wanStatusBadge.textContent=(s.ifName||'?')+' · down';}
}

// ── System ─────────────────────────────────────────────────────────────────
function gauge(label,pct,cls){
  var fillCls=pct>90?'crit':pct>75?'warn':cls;
  var valCls=pct>90?' gauge-val-crit':pct>75?' gauge-val-warn':'';
  return'<div class="gauge-item"><div class="gauge-label">'+esc(label)+'</div>'+
    '<div class="gauge-track"><div class="gauge-fill '+fillCls+'" style="width:'+pct+'%"></div></div>'+
    '<div class="gauge-val'+valCls+'">'+pct+'%</div></div>';
}
socket.on('system:update',function(d){
  var ut = parseUptime(d.uptimeRaw);
  uptimeDisplay.textContent = 'Uptime: '+ut;
  if(uptimeChip){uptimeChip.textContent=ut;uptimeChip.style.display='';}
  var html=gauge('CPU',d.cpuLoad,'cpu')+gauge('RAM',d.memPct,'mem');
  if(d.totalHdd>0)html+=gauge('Storage',d.hddPct,'hdd');
  gaugeRow.innerHTML=html;
  var meta='';
  if(d.boardName)meta+='<div class="sys-meta-item"><strong>'+esc(d.boardName)+'</strong></div>';
  if(d.version)  meta+='<div class="sys-meta-item">ROS <strong>'+esc(d.version)+'</strong></div>';
  if(d.cpuCount) meta+='<div class="sys-meta-item"><strong>'+d.cpuCount+'</strong>\u00d7CPU</div>';
  if(d.cpuFreq)  meta+='<div class="sys-meta-item"><strong>'+d.cpuFreq+'</strong> MHz</div>';
  if(d.tempC!=null)meta+='<div class="sys-meta-item"><strong>'+d.tempC+'\u00b0C</strong></div>';
  if(d.totalMem) meta+='<div class="sys-meta-item"><strong>'+fmtBytes(d.totalMem)+'</strong> RAM</div>';
  sysMeta.innerHTML=meta;
  if(rosUpdateRow){
    var ur='';
    if(d.updateAvailable&&d.latestVersion){
      var installedBase=(d.version||'').replace(/\s*\(.*\)/,'').trim();
      ur='<div class="ros-update-row warn"><span class="ros-update-dot"></span>&#11014; '+esc(installedBase)+' &rarr; <strong>'+esc(d.latestVersion)+'</strong> available</div>';
    }else if(d.latestVersion){
      ur='<div class="ros-update-row ok"><span class="ros-update-dot"></span>&#10003; RouterOS <strong>'+esc(d.latestVersion)+'</strong> &mdash; Up to date</div>';
    }else if(d.updateStatus){
      ur='<div class="ros-update-row pending"><span class="ros-update-dot"></span>'+esc(d.updateStatus)+'</div>';
    }else{
      ur='<div class="ros-update-row pending"><span class="ros-update-dot"></span>Checking for updates\u2026</div>';
    }
    rosUpdateRow.innerHTML=ur;
  }
  if(d.boardName&&!routerTag.textContent){
    var tag=d.boardName+(d.version?' \u00b7 ROS '+d.version:'');
    routerTag.textContent=tag;
  }
});

// ── LAN ────────────────────────────────────────────────────────────────────
socket.on('lan:overview',function(data){
  // Detect local country from WAN IP for arc origin
  if(window._wanGeoDetect) window._wanGeoDetect(data.wanIp);
  // WAN IP — update both original field and diagram
  var wip=(data.wanIp||'').split('/')[0]||'—';
  var ndWanIp=$('ndWanIp'); if(ndWanIp)ndWanIp.textContent=wip;

  // LAN info strip
  var nets=(data&&data.networks)?data.networks:[];
  var ndLanCidr=$('ndLanCidr'); if(ndLanCidr)ndLanCidr.textContent=nets.length?nets.map(function(n){return n.cidr;}).join(', '):'—';
  var ndGateway=$('ndGateway'); if(ndGateway)ndGateway.textContent=nets.length&&nets[0].gateway?nets[0].gateway:'—';

  var totalLeases = nets.reduce(function(acc, n){ return acc + (n.leaseCount || 0); }, 0);
  var ndWiredCount = $('ndWiredCount');
  if (ndWiredCount) ndWiredCount.textContent = totalLeases || '—';

  if(!nets.length){if(lastLanData)return;lanOverview.innerHTML='<div class="empty-state">No DHCP networks</div>';return;}
  lastLanData=data;
  lanOverview.innerHTML=nets.map(function(n){
    return'<div class="lan-net"><div class="lan-cidr"><span style="color:var(--text-muted);font-size:.65rem;margin-right:.3rem">LAN:</span>'+esc(n.cidr)+'</div>'+
      '<div class="lan-meta">GW: '+esc(n.gateway||'—')+' '+DOT+' DNS: '+esc(n.dns||'—')+' '+DOT+' <strong style="color:rgba(200,215,240,.75)">'+n.leaseCount+'</strong> leases</div></div>';
  }).join('');
});

socket.on('wan:ips', function(data) {
  var ips = data.ips || [];
  var ndWanIp = $('ndWanIp');
  if (ndWanIp) ndWanIp.textContent = ips.length ? ips[0].split('/')[0] : '—';
  if (wanIpDisplay) {
    if (!ips.length) { wanIpDisplay.textContent = '—'; return; }
    wanIpDisplay.innerHTML = ips.map(function(ip) {
      return '<span style="display:block;line-height:1.4">' + ip + '</span>';
    }).join('');
  }
});

// ── Connections ────────────────────────────────────────────────────────────
var sparkCanvas=$('connSparkCanvas');
var sparkCtx2d=sparkCanvas?sparkCanvas.getContext('2d'):null;
function drawSparkline(history){
  if(!sparkCtx2d||!history||history.length<2)return;
  var w=sparkCanvas.width,h=sparkCanvas.height;
  sparkCtx2d.clearRect(0,0,w,h);
  var vals=history.map(function(p){return p.total;});
  var maxV=Math.max.apply(null,vals)||1;
  sparkCtx2d.beginPath();
  sparkCtx2d.strokeStyle='#38bdf8';sparkCtx2d.lineWidth=1.5;sparkCtx2d.lineJoin='round';
  for(var i=0;i<vals.length;i++){
    var x=(i/(vals.length-1))*w,y=h-(vals[i]/maxV)*(h-2)-1;
    i===0?sparkCtx2d.moveTo(x,y):sparkCtx2d.lineTo(x,y);
  }
  sparkCtx2d.stroke();
}
function renderProtoBars(pc){
  if(!protoBars||!pc)return;
  var total=pc.tcp+pc.udp+pc.icmp+pc.other||1;
  var items=[{k:'TCP',c:'tcp',v:pc.tcp},{k:'UDP',c:'udp',v:pc.udp},{k:'ICMP',c:'icmp',v:pc.icmp},{k:'Other',c:'other',v:pc.other}];
  protoBars.innerHTML=items.map(function(it){
    var pct=Math.round((it.v/total)*100);
    return'<div class="proto-bar-row"><div class="proto-label">'+it.k+'</div>'+
      '<div class="proto-track"><div class="proto-fill '+it.c+'" style="width:'+pct+'%"></div></div>'+
      '<div class="proto-val">'+it.v+'</div></div>';
  }).join('');
}
socket.on('conn:update',function(data){
  connTotal.textContent=data.total;
  var connNavBadge=$("connNavBadge"); if(connNavBadge) connNavBadge.textContent=data.total;
  connHistory.push({ts:data.ts,total:data.total});
  if(connHistory.length>MAX_CONN_HIST)connHistory.shift();
  drawSparkline(connHistory);
  renderProtoBars(data.protoCounts);
  if(data.topSources&&data.topSources.length){
    topSources.innerHTML=data.topSources.map(function(s){
      return'<div class="top-row"><div><div class="top-name">'+esc(s.name)+'</div><div class="top-sub">'+esc(s.ip)+(s.mac?' '+DOT+' '+esc(s.mac):'')+' </div></div><div class="top-count">'+s.count+'</div></div>';
    }).join('');
  }else{topSources.innerHTML='<div class="empty-state">\u2014</div>';}
  if(data.topDestinations&&data.topDestinations.length){
    topDests.innerHTML=data.topDestinations.map(function(d){
      var flag='',geoLabel='';
      if(d.country){
        flag=d.country.split('').map(function(c){return String.fromCodePoint(0x1F1E6-65+c.toUpperCase().charCodeAt(0));}).join('');
        geoLabel=flag+(d.city?' '+esc(d.city)+' · '+esc(d.country):'');
      }
      return'<div class="top-row">'+
        '<div class="top-name text-truncate" style="flex:1;min-width:0">'+esc(d.key)+'</div>'+
        (geoLabel?'<div class="top-geo">'+geoLabel+'</div>':'')+
        '<div class="top-count">'+d.count+'</div>'+
      '</div>';
    }).join('');
  }else{topDests.innerHTML='<div class="empty-state">\u2014</div>';}
});

// ── Top Talkers ────────────────────────────────────────────────────────────
socket.on('neighbors:update',function(data){
  var neighbors=data.neighbors||[];
  var tbody=$('neighborsTable');
  if(!tbody) return;
  if(!neighbors.length){tbody.innerHTML='<tr><td colspan="4" class="empty-state">No neighbours found</td></tr>';return;}
  tbody.innerHTML=neighbors.map(function(n){
    return '<tr>'+
      '<td style="font-weight:600">'+esc(n.identity||'—')+'</td>'+
      '<td style="font-family:var(--font-mono);font-size:.75rem;color:var(--accent-rx)">'+esc(n.address||'—')+'</td>'+
      '<td style="font-size:.75rem;color:var(--text-muted)">'+esc(n.interface||'—')+'</td>'+
      '<td style="font-size:.72rem;color:var(--text-muted)">'+esc(n.version||'—')+'</td>'+
      '</tr>';
  }).join('');
});

socket.on('routes:update', function(data){
  var tbody = $('routesTable');
  var pageBody = $('routesPageTable');
  var badge = $('routesTotalBadge');
  var routes = data.routes || [];
  window._allRoutes = routes;

  var nb = $('routesNavBadge');
  if (nb) nb.textContent = routes.length;

  // Dashboard card
  if (tbody) {
    if (!routes.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No routes</td></tr>';
    } else {
      tbody.innerHTML = routes.map(function(r){
        var isStatic = r.type === 'static';
        var dstColor = isStatic ? 'color:var(--text-main);font-weight:600' : 'color:var(--text-muted)';
        var typePill = isStatic
          ? '<span style="font-size:.65rem;padding:.1rem .35rem;border-radius:3px;background:rgba(245,158,11,.15);color:#f59e0b">static</span>'
          : '<span style="font-size:.65rem;padding:.1rem .35rem;border-radius:3px;background:rgba(99,130,190,.15);color:var(--text-muted)">connected</span>';
        return '<tr>'+
          '<td style="font-family:var(--font-mono);font-size:.75rem;'+dstColor+'">'+esc(r.dst)+'</td>'+
          '<td style="font-size:.75rem;color:var(--text-muted)">'+esc(r.gateway)+'</td>'+
          '<td>'+typePill+'</td>'+
          '</tr>';
      }).join('');
    }
  }

  // Routes page
  renderRoutesPage(routes, (document.getElementById('routesSearch')||{value:''}).value);
});

function renderRoutesPage(routes, filter){
  var pageBody = $('routesPageTable');
  var badge    = $('routesTotalBadge');
  if (!pageBody) return;
  var filtered = filter
    ? routes.filter(function(r){
        var hay = (r.dst+' '+r.gateway+' '+r.comment+' '+r.type+' '+r.flags).toLowerCase();
        return hay.indexOf(filter.toLowerCase()) !== -1;
      })
    : routes;
  if (badge) badge.textContent = filtered.length;
  if (!filtered.length) {
    pageBody.innerHTML = '<tr><td colspan="6" class="empty-state">No routes'+(filter?' matching filter':'')+'\u2026</td></tr>';
    return;
  }
  pageBody.innerHTML = filtered.map(function(r){
    var isStatic = r.type === 'static';
    var typePill = isStatic
      ? '<span style="font-size:.65rem;padding:.1rem .35rem;border-radius:3px;background:rgba(245,158,11,.15);color:#f59e0b">static</span>'
      : '<span style="font-size:.65rem;padding:.1rem .35rem;border-radius:3px;background:rgba(99,130,190,.15);color:var(--text-muted)">connected</span>';
    return '<tr>'+
      '<td style="font-family:var(--font-mono);font-size:.72rem;color:var(--text-muted)">'+esc(r.flags||'')+'</td>'+
      '<td style="font-family:var(--font-mono);font-size:.75rem;'+(isStatic?'font-weight:600':'color:var(--text-muted)')+'">'+esc(r.dst)+'</td>'+
      '<td style="font-size:.75rem;color:var(--text-muted)">'+esc(r.gateway)+'</td>'+
      '<td style="font-family:var(--font-mono);font-size:.75rem;text-align:center">'+esc(String(r.distance))+'</td>'+
      '<td style="font-size:.72rem;color:var(--text-muted);font-style:'+(r.comment?'normal':'italic')+'">'+esc(r.comment||'—')+'</td>'+
      '<td>'+typePill+'</td>'+
      '</tr>';
  }).join('');
}

// ── Switches ───────────────────────────────────────────────────────────────
(function(){
  var allPorts = [];
  var switchesFilter = '';
  var switchesSearch = $('switchesSearch');
  if (switchesSearch) {
    switchesSearch.addEventListener('input', function(){
      switchesFilter = this.value.trim().toLowerCase();
      renderSwitches(allPorts);
    });
  }

  // Routes search
(function(){
  var s = $('routesSearch');
  if (s) s.addEventListener('input', function(){
    renderRoutesPage(window._allRoutes || [], this.value);
  });
})();

// ── Address Lists ─────────────────────────────────────────────────────────
(function(){
  var _allLists = [];

  function renderAddressLists(lists, filter) {
    var content = $('addressListsContent');
    if (!content) return;
    var f = (filter || '').toLowerCase();

    var filtered = lists.map(function(l){
      var entries = f ? l.entries.filter(function(e){
        return (l.name+' '+e.address+' '+e.comment).toLowerCase().indexOf(f) !== -1;
      }) : l.entries;
      return { name: l.name, entries: entries };
    }).filter(function(l){ return l.entries.length > 0; });

    if (!filtered.length) {
      content.innerHTML = '<div class="empty-state">No address lists'+(f?' matching filter':'')+'\u2026</div>';
      return;
    }

    content.innerHTML = filtered.map(function(l){
      var rows = l.entries.map(function(e){
        return '<tr>'+
          '<td style="font-family:var(--font-mono);font-size:.75rem;color:var(--accent-rx)">'+esc(e.address)+'</td>'+
          '<td style="font-size:.75rem;color:var(--text-muted)">'+esc(e.comment||'—')+'</td>'+
          '<td style="font-size:.68rem;color:var(--text-muted)">'+esc(e.created||'')+'</td>'+
          '</tr>';
      }).join('');

      return '<div style="margin-bottom:1.5rem">'+
        '<div style="padding:.5rem 1rem;background:var(--bg-card);border-bottom:1px solid var(--border);font-weight:600;font-size:.85rem;position:sticky;top:0;z-index:1">'+
          esc(l.name)+
          '<span style="font-size:.72rem;font-weight:400;color:var(--text-muted);margin-left:.5rem">'+l.entries.length+' entries</span>'+
        '</div>'+
        '<table class="table table-vcenter mb-0" style="font-size:.78rem">'+
          '<thead><tr><th style="width:30%">Address</th><th style="width:45%">Comment</th><th style="width:25%">Created</th></tr></thead>'+
          '<tbody>'+rows+'</tbody>'+
        '</table>'+
      '</div>';
    }).join('');
  }

  socket.on('addresslists:update', function(data){
    _allLists = data.lists || [];
    renderAddressLists(_allLists, ($('addressListsSearch')||{value:''}).value);
    var nb = $('addressListsNavBadge');
    if (nb) nb.textContent = _allLists.length;
  });

  var s = $('addressListsSearch');
  if (s) s.addEventListener('input', function(){
    renderAddressLists(_allLists, this.value);
  });
})();

  function renderSwitches(ports) {
    var tbody  = $('switchesTable');
    var badge  = $('switchesTotalBadge');
    var navBadge = $('switchesNavBadge');
    if (!tbody) return;
    var filtered = switchesFilter
      ? ports.filter(function(p){
          var hay = (p.switch+' '+p.port+' '+p.mac+' '+p.name+' '+(p.ip||'')).toLowerCase();
          return hay.indexOf(switchesFilter) !== -1;
        })
      : ports;
    if (badge) { badge.textContent = filtered.length; }
    if (navBadge) { navBadge.textContent = ports.length || ''; }
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No switch data'+(switchesFilter?' matching filter':'')+'\u2026</td></tr>';
      return;
    }
    // Sort by switch name then port
    filtered.sort(function(a,b){
      if (a.switch !== b.switch) return a.switch.localeCompare(b.switch);
      return a.port.localeCompare(b.port, undefined, {numeric:true});
    });
    tbody.innerHTML = filtered.map(function(p){
return '<tr>'+
        '<td style="font-size:.75rem;color:var(--text-muted)">'+esc(p.switch)+'</td>'+
        '<td style="font-family:var(--font-mono);font-size:.75rem;font-weight:600">'+esc(p.port)+'</td>'+
        '<td style="font-family:var(--font-mono);font-size:.72rem;color:var(--text-muted)">'+esc(p.mac)+'</td>'+
        '<td style="font-weight:600">'+esc(p.name||'—')+'</td>'+
        '<td style="font-family:var(--font-mono);font-size:.75rem;color:var(--accent-rx)">'+esc(p.ip||'—')+'</td>'+
        '<td style="font-size:.75rem;color:var(--text-muted)">'+esc(p.vlan||'—')+'</td>'+
        '</tr>';
    }).join('');
  }

socket.on('switches:update', function(data){
    allPorts = data.ports || [];
    renderSwitches(allPorts);
    // Rebuild MAC -> port lookup for DHCP table
    window._switchPortByMac = {};
    allPorts.forEach(function(p){
      window._switchPortByMac[p.mac.toLowerCase()] = { switch: p.switch, port: p.port };
    });
    // Re-render DHCP if already loaded
    if (allLeases && allLeases.length) renderDhcp(allLeases);
  });
})();

// ── Interface Status ───────────────────────────────────────────────────────
socket.on('ifstatus:update',function(data){
  var ifaces=data.interfaces||[];
  var nb=$('ifacesNavBadge');if(nb){nb.textContent=ifaces.length||'';}
  if(!ifaces.length){if(ifaceGrid)ifaceGrid.innerHTML='<div class="empty-state">No interfaces</div>';return;}
  if(!ifaceGrid)return;
  ifaceGrid.innerHTML=ifaces.map(function(i){
    var cls=i.disabled?'disabled':i.running?'up':'down';
    var dotCls=i.disabled?'dis':i.running?'up':'down';
    var ipStr=i.ips&&i.ips.length?i.ips.join(' / '):'';
    var rateStr=(i.rxMbps||i.txMbps)?'\u2193 '+i.rxMbps+' \u2191 '+i.txMbps+' Mbps':'';
    return'<div class="iface-tile '+cls+'">'+
      '<div class="iface-name"><span class="iface-dot '+dotCls+'"></span>'+esc(i.name)+'</div>'+
      '<div class="iface-type">'+esc(i.type)+(i.comment?' \u00b7 '+esc(i.comment):'')+'</div>'+
      (i.ips&&i.ips.length?i.ips.map(function(ip){return'<div class="iface-ip">'+esc(ip)+'</div>';}).join(''):'')+
      (rateStr?'<div class="iface-rate">'+rateStr+'</div>':'')+
      '</div>';
  }).join('');
});

// ── Wireless ───────────────────────────────────────────────────────────────
// ── Wireless ───────────────────────────────────────────────────────────────
(function(){
  var _wlClients = [];
  var _wlSort    = 'signal';

  function sigQuality(dbm){
    if(dbm>=-55) return'<span style="color:rgba(52,211,153,.9)">Excellent</span>';
    if(dbm>=-65) return'<span style="color:rgba(56,189,248,.9)">Good</span>';
    if(dbm>=-75) return'<span style="color:rgba(251,191,36,.9)">Fair</span>';
    return'<span style="color:rgba(248,113,113,.9)">Poor</span>';
  }

  function parseTxRateNum(raw){
    if(!raw) return 0;
    var s=String(raw).trim();
    var m=s.match(/([\d.]+)\s*(G|M|K)/i);
    if(!m) return 0;
    var v=parseFloat(m[1]), u=m[2].toUpperCase();
    return u==='G'?v*1000:u==='K'?v/1000:v;
  }

  function uptimeToSecs(u){
    if(!u) return 0;
    var total=0, m;
    if((m=u.match(/(\d+)w/))) total+=parseInt(m[1])*604800;
    if((m=u.match(/(\d+)d/))) total+=parseInt(m[1])*86400;
    if((m=u.match(/(\d+)h/))) total+=parseInt(m[1])*3600;
    if((m=u.match(/(\d+)m/))) total+=parseInt(m[1])*60;
    if((m=u.match(/(\d+)s/))) total+=parseInt(m[1]);
    return total;
  }

  function bandBadge(band){
    if(!band) return'';
    var cls=band==='5GHz'?'wl-band-5':band==='6GHz'?'wl-band-6':'wl-band-24';
    return'<span class="wl-band '+cls+'">'+band+'</span>';
  }

  function sortClients(clients, key){
    var c=clients.slice();
    if(key==='signal') c.sort(function(a,b){return b.signal-a.signal;});
    else if(key==='txRate') c.sort(function(a,b){return parseTxRateNum(b.txRate)-parseTxRateNum(a.txRate);});
    else if(key==='uptime') c.sort(function(a,b){return uptimeToSecs(b.uptime)-uptimeToSecs(a.uptime);});
    else if(key==='name') c.sort(function(a,b){return(a.name||a.mac).localeCompare(b.name||b.mac);});
    return c;
  }

  function renderWireless(){
    if(!wirelessTable) return;
    var clients=sortClients(_wlClients, _wlSort);
    if(!clients.length){
      wirelessTable.innerHTML='<tr><td colspan="6" class="empty-state">No wireless clients</td></tr>';
      return;
    }
    // Group by interface
    var groups={}, order=[];
    clients.forEach(function(c){
      var key=c.iface||'unknown';
      if(!groups[key]){ groups[key]={iface:key,ssid:c.ssid,clients:[]}; order.push(key); }
      groups[key].clients.push(c);
    });
    var rows='';
    order.forEach(function(key){
      var g=groups[key];
      var multiGroup=order.length>1;
      if(multiGroup){
        rows+='<tr class="wl-group-row"><td colspan="6">'+
          '<span class="wl-group-label">'+esc(g.iface)+'</span>'+
          (g.ssid?'<span class="wl-group-sub">'+esc(g.ssid)+'</span>':'')+
          '<span class="wl-group-sub">'+g.clients.length+' client'+(g.clients.length!==1?'s':'')+'</span>'+
        '</td></tr>';
      }
      g.clients.forEach(function(c){
        var sig=parseInt(c.signal,10)||0;
        var txMbps=parseTxRateNum(c.txRate);
        var idle=false;
        var ipStr=c.ip?'<div style="font-size:.62rem;color:var(--accent-rx)">'+esc(c.ip)+'</div>':'';
        var macStr='<div style="font-size:.6rem;color:var(--text-muted)">'+esc(c.mac)+'</div>';
        rows+='<tr'+(idle?' class="wl-idle"':'')+'>'+
          '<td>'+
            '<div style="font-weight:600;font-size:.78rem">'+esc(c.name||c.mac)+
              (idle?'<span class="wl-idle-tag">idle</span>':'')+
            '</div>'+
            ipStr+macStr+
          '</td>'+
          '<td class="wl-col-band">'+bandBadge(c.band)+'</td>'+
          '<td class="wl-col-iface" style="color:var(--text-muted);font-size:.73rem">'+esc(c.iface||'\u2014')+'</td>'+
          '<td class="text-end">'+
            signalBars(sig)+
            '<span style="font-size:.68rem;color:var(--text-muted);margin-left:.3rem">'+sig+' dBm</span>'+
            '<div style="font-size:.62rem;margin-top:.1rem">'+sigQuality(sig)+'</div>'+
          '</td>'+
          '<td>'+
            '<div class="wl-rate">'+esc(parseTxRate(c.txRate))+'</div>'+
            (c.rxRate?'<div class="wl-rate-rx">\u2191 '+esc(parseTxRate(c.rxRate))+'</div>':'')+
          '</td>'+
          '<td class="wl-col-uptime" style="color:var(--text-muted);font-size:.73rem">'+esc(c.uptime||'\u2014')+'</td>'+
        '</tr>';
      });
    });
    wirelessTable.innerHTML=rows;
  }

  socket.on('wireless:update',function(data){
    _wlClients=data.clients||[];
    var ndWC=$('ndWirelessCount'); if(ndWC) ndWC.textContent=_wlClients.length;
    var badgeCls='badge '+(_wlClients.length>0?'bg-blue':'bg-secondary');
    wirelessTabBadge.textContent=_wlClients.length; wirelessTabBadge.className=badgeCls;
    wirelessNavBadge.textContent=_wlClients.length;
    renderWireless();
  });

  // Sort buttons
  var sortBtns=$('wifiSortBtns');
  if(sortBtns) sortBtns.addEventListener('click',function(e){
    var btn=e.target.closest('.wl-sort-btn'); if(!btn) return;
    _wlSort=btn.dataset.sort;
    sortBtns.querySelectorAll('.wl-sort-btn').forEach(function(b){b.classList.toggle('active',b===btn);});
    renderWireless();
  });
})();

// ── WireGuard ──────────────────────────────────────────────────────────────
socket.on('vpn:update',function(data){
  var ndVpnCount = $('ndVpnCount');
if (ndVpnCount) ndVpnCount.textContent = data.tunnels ? data.tunnels.filter(function(t){ return t.state === 'connected'; }).length : '—';
  var peers=(data.tunnels||[]).filter(function(t){return t.type==='WireGuard'&&t.state==='connected';});
  vpnCount.textContent=peers.length;
  vpnCount.className='badge '+(peers.length>0?'bg-green':'bg-secondary');
  var nb=$('vpnNavBadge'); if(nb)nb.textContent=peers.length;
  // Dashboard mini card
  if(!peers.length){vpnTable.innerHTML='<tr><td colspan="3" class="empty-state">No active peers</td></tr>';}
  else{
    vpnTable.innerHTML=peers.map(function(t){
      var endStr=t.endpoint?'<div style="font-size:.65rem;color:var(--text-muted);margin-top:.1rem">'+esc(t.endpoint)+'</div>':'';
      return'<tr>'+
        '<td><span class="wg-up">Up</span></td>'+
        '<td><div style="font-size:.78rem;font-weight:600">'+esc(t.name||t.interface||'\u2014')+'</div>'+endStr+'</td>'+
        '<td style="font-size:.7rem;color:var(--text-muted)">'+esc(t.uptime||'\u2014')+'</td>'+
        '</tr>';
    }).join('');
  }
  // VPN page — show ALL peers regardless of state
  var allPeers=(data.tunnels||[]).filter(function(t){return t.type==="WireGuard";});

  // Tile grid — all peers, active first
  allPeers.sort(function(a,b){return (b.state==='connected'?1:0)-(a.state==='connected'?1:0);});
  var grid=$('vpnPageGrid');
  if(grid){
    if(!allPeers.length){grid.innerHTML='<div class="empty-state">No peers configured</div>';}
    else{
      grid.innerHTML=allPeers.map(function(t){
        var connected=t.state==="connected";
        var rxR=t.rxRate||0,txR=t.txRate||0;
        var rxRateStr=rxR>0?'<span style="color:var(--accent-rx)">↓ '+fmtBytes(Math.round(rxR))+'/s</span>':'';
        var txRateStr=txR>0?'<span style="color:var(--accent-tx)">↑ '+fmtBytes(Math.round(txR))+'/s</span>':'';
        var totStr='<span style="color:var(--text-muted)">↓ '+fmtBytes(parseInt(t.rx,10)||0)+' ↑ '+fmtBytes(parseInt(t.tx,10)||0)+'</span>';
        var dotCls=connected?'up':'dis';
        var tileCls='vpn-tile '+(connected?'up':'idle');
        return'<div class="'+tileCls+'">'+
          '<div class="vpn-tile-name"><span class="iface-dot '+dotCls+'"></span>'+esc(t.name||t.interface||'—')+'</div>'+
          (t.interface?'<div class="vpn-tile-iface">'+esc(t.interface)+(t.allowedIp?' · '+esc(t.allowedIp):'')+'</div>':'')+
          (t.endpoint?'<div class="vpn-tile-ip">'+esc(t.endpoint)+'</div>':'')+
          '<div class="vpn-tile-hs">'+(connected&&t.uptime&&t.uptime!=='never'?'HS: '+esc(t.uptime):'Never connected')+'</div>'+
          
        '</div>';
      }).join('');
    }
  }
});

// ── DHCP Leases ────────────────────────────────────────────────────────────
function renderDhcp(leases){
  var filtered = leaseFilter
    ? leases.filter(function(l){
        var sp=window._switchPortByMac&&l.mac?(window._switchPortByMac[l.mac.toLowerCase()]||null):null;
        var hay=(l.name+' '+l.ip+' '+l.mac+' '+l.comment+' '+(sp?sp.switch+' '+sp.port:'')).toLowerCase();
        return hay.indexOf(leaseFilter)!==-1;
      })
    : leases;
  var count = leases.length;
  if(dhcpTotalBadge){
    dhcpTotalBadge.textContent = count;
    dhcpTotalBadge.className = 'badge ' + (count > 0 ? 'bg-blue' : 'bg-secondary');
    dhcpTotalBadge.style.fontFamily = 'var(--font-mono)';
    dhcpTotalBadge.style.fontSize = '.68rem';
  }
  if(dhcpNavBadge) dhcpNavBadge.textContent = count;
if(!filtered.length){dhcpTable.innerHTML='<tr><td colspan="8" class="empty-state">No leases'+(leaseFilter?' matching filter':'')+'\u2026</td></tr>';return;}
  dhcpTable.innerHTML=filtered.map(function(l){
    var st=(l.status||'').toLowerCase();
    var pillCls=st==='bound'?'bound':st==='waiting'||st==='offered'?'waiting':'expired';
    var typeCls=l.type==='static'?'color:#f59e0b':'color:var(--text-muted)';
    var sp=window._switchPortByMac&&l.mac?(window._switchPortByMac[l.mac.toLowerCase()]||null):null;
    return'<tr>'+
      '<td style="font-weight:600">'+esc(l.name||l.hostName||'\u2014')+'</td>'+
      '<td style="color:var(--accent-rx)">'+esc(l.ip)+'</td>'+
      '<td style="font-size:.7rem;color:var(--text-muted)">'+esc(l.mac||'\u2014')+'</td>'+
      '<td><span class="lease-pill '+pillCls+'">'+esc(l.status||'?')+'</span></td>'+
      '<td style="font-size:.75rem;'+typeCls+'">'+esc(l.type||'dynamic')+'</td>'+
      '<td style="font-size:.75rem;color:var(--text-muted)">'+esc((sp&&sp.switch)||'\u2014')+'</td>'+
      '<td style="font-family:var(--font-mono);font-size:.72rem;color:var(--text-muted)">'+esc((sp&&sp.port)||'\u2014')+'</td>'+
      (dhcpCanWrite && l.type==='dynamic'
        ? '<td><button class="btn btn-sm btn-outline-success py-0 px-1 make-static-btn" data-ip="'+esc(l.ip)+'" style="font-size:.65rem;line-height:1.4">Reserve</button></td>'
        : dhcpCanWrite && l.type==='static'
        ? '<td><button class="btn btn-sm btn-outline-danger py-0 px-1 remove-static-btn" data-ip="'+esc(l.ip)+'" style="font-size:.65rem;line-height:1.4">Release</button></td>'
        : '<td></td>')+
      '</tr>';
  }).join('');

  // Wire up Reserve buttons
  dhcpTable.querySelectorAll('.make-static-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var ip = btn.dataset.ip;
      btn.disabled = true;
      btn.textContent = '…';
      secureApiCall('/api/dhcp/make-static', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: ip })
      }).then(function(r){ return r.json(); }).then(function(data){
        if (data.ok) {
          // Update lease type in local cache and re-render immediately
          var lease = allLeases.find(function(l){ return l.ip === ip; });
          if (lease) lease.type = 'static';
          renderDhcp(allLeases);
        } else {
          btn.textContent = 'Error';
          btn.disabled = false;
          console.error('[dhcp] make-static error:', data.error);
        }
      }).catch(function(){
        btn.textContent = 'Error';
        btn.disabled = false;
      });
    });
  });

  // Wire up Release buttons
  dhcpTable.querySelectorAll('.remove-static-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var ip = btn.dataset.ip;
      btn.disabled = true;
      btn.textContent = '…';
      secureApiCall('/api/dhcp/remove-static', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: ip })
      }).then(function(r){ return r.json(); }).then(function(data){
        if (data.ok) {
          // Remove from local lease cache and re-render immediately
          allLeases = allLeases.filter(function(l){ return l.ip !== ip; });
          renderDhcp(allLeases);
        } else {
          btn.textContent = 'Error';
          btn.disabled = false;
          console.error('[dhcp] remove-static error:', data.error);
        }
      }).catch(function(){
        btn.textContent = 'Error';
        btn.disabled = false;
      });
    });
  });
  
}
socket.on('leases:list',function(data){
  allLeases=data.leases||[];
  renderDhcp(allLeases);
});
if(dhcpSearch) dhcpSearch.addEventListener('input',function(){
  leaseFilter=(dhcpSearch.value||'').trim().toLowerCase();
  renderDhcp(allLeases);
});

// ── Firewall ───────────────────────────────────────────────────────────────
socket.on('firewall:update',function(data){fwData=data;renderFirewallTab();});
function renderFirewallTab(){
  var rules=fwTab==='top'?(fwData.topByHits||[]):fwTab==='filter'?(fwData.filter||[]):fwTab==='nat'?(fwData.nat||[]):(fwData.mangle||[]);
  if(!rules.length){firewallTable.innerHTML='<tr><td colspan="5" class="empty-state">No rules with hits</td></tr>';return;}
  firewallTable.innerHTML=rules.map(function(r){
    var sd=[r.srcAddress,r.dstAddress].filter(Boolean).join(' \u2192 ')||(r.inInterface||'');
    if(!sd&&r.dstPort)sd=':'+r.dstPort;
    if(r.protocol)sd+=(sd?' ':'')+'/ '+r.protocol;
    return'<tr'+(r.disabled?' style="opacity:.4"':'')+'>'+
      '<td style="font-size:.7rem;color:var(--text-muted)">'+esc(r.chain)+'</td>'+
      '<td>'+actionBadge(r.action)+'</td>'+
      '<td style="font-size:.7rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(sd||'\u2014')+'</td>'+
      '<td style="font-size:.7rem;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.comment||'\u2014')+'</td>'+
      '<td class="text-end" style="font-family:var(--font-mono)">'+r.packets.toLocaleString()+'</td>'+
      '</tr>';
  }).join('');
}

// ── Logs ───────────────────────────────────────────────────────────────────
var logBuffer=[],MAX_LOG_LINES=2000;
function topicClass(t){t=String(t).toLowerCase();if(t.includes('firewall')||t.includes('forward'))return'log-firewall';if(t.includes('dhcp'))return'log-dhcp';if(t.includes('wireless')||t.includes('wifi')||t.includes('wlan'))return'log-wireless';if(t.includes('system'))return'log-system';return'log-topic';}
function sevClass(s){return s==='error'?'log-error':s==='warning'?'log-warning':s==='debug'?'log-debug':'log-info';}
function buildLogHtml(l){return'<span class="log-time">'+esc(l.time)+'</span> <span class="'+topicClass(l.topics)+'">['+esc(l.topics)+']</span> <span class="'+sevClass(l.severity)+'">'+esc(l.message)+'</span>';}
function flushLogs(){
  var f=logBuffer.filter(function(e){if(logLevel&&e.severity!==logLevel)return false;if(logFilter&&e.text.indexOf(logFilter)===-1)return false;return true;});
  logsEl.innerHTML=f.map(function(e){return e.html;}).join('\n');
  if(autoScroll)logsEl.scrollTop=logsEl.scrollHeight;
}
socket.on('logs:new',function(line){
  var html=buildLogHtml(line);
  var text=(line.time+' ['+line.topics+'] '+line.message).toLowerCase();
  var entry={html:html,severity:line.severity,text:text};
  logBuffer.push(entry);
  if(logBuffer.length>MAX_LOG_LINES)logBuffer.shift();
  if(logLevel&&entry.severity!==logLevel)return;
  if(logFilter&&text.indexOf(logFilter)===-1)return;
  logsEl.insertAdjacentHTML('beforeend',html+'\n');
  var lines=logsEl.innerHTML.split('\n');
  if(lines.length>MAX_LOG_LINES+50)logsEl.innerHTML=lines.slice(-MAX_LOG_LINES).join('\n');
  if(autoScroll)logsEl.scrollTop=logsEl.scrollHeight;
});
logSearch.addEventListener('input',function(){logFilter=(logSearch.value||'').trim().toLowerCase();flushLogs();});
logSeverity.addEventListener('change',function(){logLevel=logSeverity.value;flushLogs();});
toggleScroll.addEventListener('click',function(){autoScroll=!autoScroll;toggleScroll.textContent=autoScroll?'Pause':'Resume';});
clearLogs.addEventListener('click',function(){logBuffer=[];logsEl.innerHTML='';});

// ── Interface + window selectors ───────────────────────────────────────────
socket.on('interfaces:list',function(data){
  if(data.interfaces&&data.interfaces.length){
    ifaceSelect.innerHTML='';
    data.interfaces.forEach(function(i){
      var opt=document.createElement('option');
      opt.value=i.name;
      var suf=(i.disabled==='true'||i.disabled===true)?' [disabled]':(!i.running||i.running==='false')?' [down]':'';
      opt.textContent=i.name+suf;
      ifaceSelect.appendChild(opt);
    });
  }
  if(data.defaultIf)ifaceSelect.value=data.defaultIf;
});
ifaceSelect.addEventListener('change',function(){socket.emit('traffic:select',{ifName:ifaceSelect.value});});
var windowSelect=$('windowSelect');
var WINDOW_OPTIONS={'1m':60,'5m':300,'15m':900,'30m':1800};
if(windowSelect){windowSelect.addEventListener('change',function(){applyWindow(WINDOW_OPTIONS[windowSelect.value]||60);});}

// ── Traffic events ─────────────────────────────────────────────────────────
socket.on('traffic:history',function(data){
  currentIf=data.ifName; ifaceSelect.value=data.ifName;
  var pts=data.points||[]; initChart(pts);
  if(pts.length){var last=pts[pts.length-1];liveRx.textContent=fmtMbps(last.rx_mbps);liveTx.textContent=fmtMbps(last.tx_mbps);}
});
socket.on('traffic:update',function(sample){if(!currentIf||sample.ifName!==currentIf)return;pushChartPoint(sample);});
socket.on('wan:status',function(s){renderWanStatus(s);});

// ── Reconnect ──────────────────────────────────────────────────────────────
socket.on('disconnect',function(){reconnectBanner.classList.add('show');});
socket.on('connect',function(){reconnectBanner.classList.remove('show');currentIf='';allPoints=[];});

// ── Stale detection ────────────────────────────────────────────────────────
var staleConfig=[
  {cardId:'trafficCard',  event:'traffic:update',  threshold:10000},
  {cardId:'systemCard',   event:'system:update',   threshold:15000},
  {cardId:'connCard',     event:'conn:update',      threshold:20000},
  {cardId:'neighborsCard',  event:'neighbors:update',  threshold:120000},
  {cardId:'routesCard',     event:'routes:update',     threshold:60000},
  {cardId:'wirelessCard', event:'wireless:update', threshold:60000},
  {cardId:'vpnCard',      event:'vpn:update',       threshold:30000},
  {cardId:'firewallCard', event:'firewall:update', threshold:30000},
  {cardId:'ifStatusCard', event:'ifstatus:update', threshold:20000},
  {cardId:'networksCard',  event:'lan:overview',    threshold:60000},

];
var staleTimers={};
staleConfig.forEach(function(cfg){
  staleTimers[cfg.cardId]=0;
  socket.on(cfg.event,function(){staleTimers[cfg.cardId]=Date.now();var card=$(cfg.cardId);if(card)card.classList.remove('is-stale');});
});
setInterval(function(){
  var now=Date.now();
  staleConfig.forEach(function(cfg){
    var last=staleTimers[cfg.cardId],card=$(cfg.cardId);
    if(!card)return;
    if(last>0&&now-last>cfg.threshold)card.classList.add('is-stale');
  });
},3000);

// ── Ping / Latency ─────────────────────────────────────────────────────────
var pingChartNet = null;

function pingColor(rtt){
  if(rtt==null)return'rgba(148,163,190,.4)';
  if(rtt<50)return'rgba(74,222,128,.8)';
  if(rtt<150)return'rgba(251,146,60,.8)';
  return'rgba(248,113,113,.8)';
}
function rttClass(rtt){
  if(rtt==null)return'';
  if(rtt<50)return'ping-ok';
  if(rtt<150)return'ping-warn';
  return'ping-bad';
}
function makePingChart(canvasId){
  var ctx=document.getElementById(canvasId);
  if(!ctx)return null;
  return new Chart(ctx,{
    type:'bar',
    data:{labels:[],datasets:[{data:[],backgroundColor:[],borderRadius:2,borderSkipped:false}]},
    options:{
      responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},tooltip:{
        callbacks:{label:function(c){return c.raw==null?'timeout':c.raw+'ms';}}}},
      scales:{
        x:{display:false},
        y:{display:true,min:0,grid:{color:'rgba(99,130,190,.08)'},
           ticks:{color:'rgba(148,163,190,.5)',font:{size:9},maxTicksLimit:3,callback:function(v){return v+'ms';}}}
      }
    }
  });
}
function updatePingChart(chart,history){
  if(!chart)return;
  var pts=history.slice(-50);
  chart.data.labels=pts.map(function(p){return'';});
  chart.data.datasets[0].data=pts.map(function(p){return p.rtt;});
  chart.data.datasets[0].backgroundColor=pts.map(function(p){return pingColor(p.rtt);});
  chart.update('none');
}
socket.on('ping:update',function(data){
  var rtt=data.rtt, loss=data.loss, history=data.history||[];
  // Networks card
  var rttEl=$('ndPingRtt'),lossEl=$('ndPingLoss');
  if(rttEl){
    rttEl.textContent=rtt!=null?rtt:'—';
    rttEl.className='ping-val '+rttClass(rtt);
  }
  if(lossEl){
    lossEl.textContent=loss+'%';
    lossEl.className='ping-val '+(loss===0?'ping-ok':loss<50?'ping-warn':'ping-bad');
  }
  // VPN page
  var vRtt=$('vpnPingRtt'),vLoss=$('vpnPingLoss');

  // Charts — initialise lazily on first data
  if(!pingChartNet)pingChartNet=makePingChart('pingChartNet');
  updatePingChart(pingChartNet,history);
});

// ── Browser Notifications ──────────────────────────────────────────────────
var _notifEnabled = false;
var _notifPrevIface = {};   // name -> wasRunning
var _notifPrevVpn   = {};   // name -> wasConnected
var _cpuAlertedAt   = 0;
var _pingAlertedAt  = 0;
var NOTIF_COOLDOWN  = 60000; // 1 min between repeat alerts

function notifSupported(){ return 'Notification' in window; }

function sendNotif(title, body, tag){
  if(!_notifEnabled) return;
  try{ new Notification(title,{body:body,tag:tag,icon:'/logo.png',silent:false}); }catch(e){}
}

function initNotifications(){
  if(!notifSupported()) return;
  Notification.requestPermission().then(function(p){
    _notifEnabled = (p === 'granted');
    var btn = $('notifToggleBtn');
    if(btn) updateNotifBtn();
  });
}

function updateNotifBtn(){
  var btn = $('notifToggleBtn');
  if(!btn) return;
  if(!notifSupported()){btn.style.display='none';return;}
  btn.title = _notifEnabled ? 'Notifications on' : 'Notifications off';
  btn.innerHTML = _notifEnabled
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  btn.style.color = _notifEnabled ? 'var(--accent-rx)' : 'var(--text-muted)';
}

// Trigger notifications from data events
function checkIfaceNotifs(ifaces){
  ifaces.forEach(function(i){
    if(i.disabled) return;
    var wasRunning = _notifPrevIface[i.name];
    var isRunning  = !!i.running;
    if(wasRunning === true && !isRunning){
      sendNotif('Interface Down', i.name + ' is no longer running', 'iface-' + i.name);
    } else if(wasRunning === false && isRunning){
      sendNotif('Interface Up', i.name + ' is back online', 'iface-' + i.name);
    }
    _notifPrevIface[i.name] = isRunning;
  });
}

function checkVpnNotifs(tunnels){
  tunnels.forEach(function(t){
    var name = t.name || t.interface || '?';
    var isConn = t.state === 'connected';
    var wasConn = _notifPrevVpn[name];
    if(wasConn === true && !isConn){
      sendNotif('VPN Peer Disconnected', name + ' has gone idle', 'vpn-' + name);
    } else if(wasConn === false && isConn){
      sendNotif('VPN Peer Connected', name + ' is now active', 'vpn-' + name);
    }
    _notifPrevVpn[name] = isConn;
  });
}

function checkCpuNotif(cpuLoad){
  var now = Date.now();
  if(cpuLoad > 90 && now - _cpuAlertedAt > NOTIF_COOLDOWN){
    sendNotif('High CPU', 'Router CPU at ' + cpuLoad + '%', 'cpu-high');
    _cpuAlertedAt = now;
  }
}

function checkPingNotif(loss){
  var now = Date.now();
  if(loss === 100 && now - _pingAlertedAt > NOTIF_COOLDOWN){
    sendNotif('Ping Loss', 'No response from 1.1.1.1 — possible WAN outage', 'ping-loss');
    _pingAlertedAt = now;
  }
  if(loss < 100) _pingAlertedAt = 0; // reset so next outage fires again
}

// Wire into existing handlers
var _origIfstatus = null;
(function(){
  var _listeners = [];
  socket.on('ifstatus:update', function(data){ checkIfaceNotifs(data.interfaces||[]); });
  socket.on('vpn:update',      function(data){ checkVpnNotifs(data.tunnels||[]); });
  socket.on('system:update',   function(d){    checkCpuNotif(d.cpuLoad); });
  socket.on('ping:update',     function(data){ checkPingNotif(data.loss); });
})();

initNotifications();

// ── Topbar clock ───────────────────────────────────────────────────────────
(function(){
  var el = $('tobarClock');
  if(!el) return;
  function tick(){
    var now = new Date();
    var h = now.getHours().toString().padStart(2,'0');
    var m = now.getMinutes().toString().padStart(2,'0');
    var s = now.getSeconds().toString().padStart(2,'0');
    el.textContent = h+':'+m+':'+s;
  }
  tick();
  setInterval(tick, 1000);
})();

// ── Notification history ───────────────────────────────────────────────────
var _notifHistory = [];
var MAX_NOTIF_HIST = 50;

function addNotifHistory(title, body){
  var ts = Date.now();
  _notifHistory.unshift({title:title, body:body, ts:ts});
  if(_notifHistory.length > MAX_NOTIF_HIST) _notifHistory.pop();
  renderNotifPanel();
  var dot = $('notifDot'); if(dot) dot.style.display = 'block';
}

function renderNotifPanel(){
  var list = $('notifList'); if(!list) return;
  if(!_notifHistory.length){
    list.innerHTML = '<div class="notif-empty">No alerts yet</div>';
    return;
  }
  list.innerHTML = _notifHistory.map(function(n){
    var age = Date.now() - n.ts;
    var ageStr = age < 60000 ? 'just now'
      : age < 3600000 ? Math.floor(age/60000)+'m ago'
      : Math.floor(age/3600000)+'h ago';
    return '<div class="notif-item">'+
      '<div class="notif-item-title">'+esc(n.title)+'</div>'+
      '<div class="notif-item-body">'+esc(n.body)+'</div>'+
      '<div class="notif-item-time">'+ageStr+'</div>'+
    '</div>';
  }).join('');
}

// Hook into sendNotif to also record history
var _origSendNotif = sendNotif;
sendNotif = function(title, body, tag){
  _origSendNotif(title, body, tag);
  addNotifHistory(title, body);
};

// Bell button: click opens/closes panel (no longer just toggles enable)
(function(){
  var btn   = $('notifToggleBtn');
  var panel = $('notifPanel');
  var dot   = $('notifDot');
  if(!btn || !panel) return;

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    var isOpen = panel.classList.contains('open');
    if(isOpen){
      panel.classList.remove('open');
    } else {
      panel.classList.add('open');
      if(dot) dot.style.display = 'none';
      renderNotifPanel(); // refresh age strings
    }
  });

  document.addEventListener('click', function(e){
    if(!panel.contains(e.target) && e.target !== btn){
      panel.classList.remove('open');
    }
  });

  var clearBtn = $('notifClearBtn');
  if(clearBtn) clearBtn.addEventListener('click', function(){
    _notifHistory = [];
    renderNotifPanel();
    if(dot) dot.style.display = 'none';
  });
})();

// ── World Map (Connections page) ───────────────────────────────────────────
(function(){
  var mapEl     = $('worldMap');
  var tooltipEl = $('mapTooltip');
  if(!mapEl) return;

  var MAP_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
  var W=1000, H=500;

  var _countryCounts  = {};   // cc -> total count
  var _countryProto   = {};   // cc -> {tcp,udp,other}
  var _countryCity    = {};   // cc -> city
  var _pathEls        = {};   // cc -> SVG path element
  var _centroids      = {};   // cc -> [x,y] projected centroid
  var _arcEls         = {};   // cc -> SVG path element (arc line)
  var _labelEls       = {};   // cc -> SVG text element
  var _sparkData      = {};   // cc -> ring array of counts (last 20 polls)
  var _selectedCC     = null;
  var _arcLayer       = null;
  var _labelLayer     = null;
  var _localCC        = 'ZZ'; // will be detected from first geo data or env

  // Known port names
  var PORT_NAMES = {'80':'HTTP','443':'HTTPS','53':'DNS','22':'SSH','21':'FTP',
    '25':'SMTP','587':'SMTP','993':'IMAP','995':'POP3','3389':'RDP','1194':'OpenVPN',
    '51820':'WireGuard','8080':'HTTP-alt','8443':'HTTPS-alt','123':'NTP','67':'DHCP',
    '110':'POP3','143':'IMAP','5353':'mDNS','1900':'UPnP'};

  var NUM_TO_ISO2 = {4:'AF',8:'AL',12:'DZ',24:'AO',32:'AR',36:'AU',40:'AT',50:'BD',
    56:'BE',64:'BT',68:'BO',76:'BR',100:'BG',104:'MM',116:'KH',120:'CM',124:'CA',
    144:'LK',152:'CL',156:'CN',170:'CO',180:'CD',188:'CR',191:'HR',192:'CU',196:'CY',
    203:'CZ',204:'BJ',208:'DK',214:'DO',218:'EC',818:'EG',222:'SV',231:'ET',246:'FI',
    250:'FR',266:'GA',276:'DE',288:'GH',300:'GR',320:'GT',332:'HT',340:'HN',348:'HU',
    356:'IN',360:'ID',364:'IR',368:'IQ',372:'IE',376:'IL',380:'IT',388:'JM',392:'JP',
    400:'JO',404:'KE',408:'KP',410:'KR',414:'KW',418:'LA',422:'LB',430:'LR',434:'LY',
    442:'LU',484:'MX',504:'MA',508:'MZ',516:'NA',524:'NP',528:'NL',540:'NC',554:'NZ',
    558:'NI',566:'NG',578:'NO',586:'PK',591:'PA',598:'PG',604:'PE',608:'PH',616:'PL',
    620:'PT',630:'PR',634:'QA',642:'RO',643:'RU',682:'SA',686:'SN',694:'SL',706:'SO',
    710:'ZA',724:'ES',729:'SD',752:'SE',756:'CH',760:'SY',762:'TJ',764:'TH',792:'TR',
    800:'UG',804:'UA',784:'AE',826:'GB',840:'US',858:'UY',860:'UZ',862:'VE',704:'VN',
    887:'YE',894:'ZM',716:'ZW',70:'BA',807:'MK',499:'ME',688:'RS',51:'AM',31:'AZ',
    112:'BY',268:'GE',398:'KZ',417:'KG',498:'MD',496:'MN',795:'TM'};

  // ISO2 -> approx centroid [lon, lat] for arc origin/destination
  var CC_NAMES = {
    AF:'Afghanistan',AL:'Albania',DZ:'Algeria',AO:'Angola',AR:'Argentina',AU:'Australia',
    AT:'Austria',BD:'Bangladesh',BE:'Belgium',BO:'Bolivia',BR:'Brazil',BG:'Bulgaria',
    MM:'Myanmar',KH:'Cambodia',CM:'Cameroon',CA:'Canada',LK:'Sri Lanka',CL:'Chile',
    CN:'China',CO:'Colombia',CD:'DR Congo',CR:'Costa Rica',HR:'Croatia',CU:'Cuba',
    CY:'Cyprus',CZ:'Czechia',DK:'Denmark',DO:'Dominican Rep.',EC:'Ecuador',EG:'Egypt',
    SV:'El Salvador',ET:'Ethiopia',FI:'Finland',FR:'France',GA:'Gabon',DE:'Germany',
    GH:'Ghana',GR:'Greece',GT:'Guatemala',HT:'Haiti',HN:'Honduras',HU:'Hungary',
    IN:'India',ID:'Indonesia',IR:'Iran',IQ:'Iraq',IE:'Ireland',IL:'Israel',IT:'Italy',
    JM:'Jamaica',JP:'Japan',JO:'Jordan',KE:'Kenya',KP:'North Korea',KR:'South Korea',
    KW:'Kuwait',LA:'Laos',LB:'Lebanon',LR:'Liberia',LY:'Libya',LU:'Luxembourg',
    MX:'Mexico',MA:'Morocco',MZ:'Mozambique',NA:'Namibia',NP:'Nepal',NL:'Netherlands',
    NZ:'New Zealand',NI:'Nicaragua',NG:'Nigeria',NO:'Norway',PK:'Pakistan',PA:'Panama',
    PG:'Papua New Guinea',PE:'Peru',PH:'Philippines',PL:'Poland',PT:'Portugal',
    QA:'Qatar',RO:'Romania',RU:'Russia',SA:'Saudi Arabia',SN:'Senegal',SO:'Somalia',
    ZA:'South Africa',ES:'Spain',SD:'Sudan',SE:'Sweden',CH:'Switzerland',SY:'Syria',
    TH:'Thailand',TR:'Turkey',UG:'Uganda',UA:'Ukraine',AE:'UAE',GB:'United Kingdom',
    US:'United States',UY:'Uruguay',VE:'Venezuela',VN:'Vietnam',YE:'Yemen',
    ZM:'Zambia',ZW:'Zimbabwe',BA:'Bosnia',RS:'Serbia',BY:'Belarus',GE:'Georgia',
    KZ:'Kazakhstan',MN:'Mongolia',TJ:'Tajikistan',TM:'Turkmenistan',UZ:'Uzbekistan',
    AZ:'Azerbaijan',AM:'Armenia',MD:'Moldova',KG:'Kyrgyzstan',MK:'N. Macedonia',
    ME:'Montenegro',NC:'New Caledonia',PR:'Puerto Rico',TZ:'Tanzania',MG:'Madagascar',
    CI:'Ivory Coast',ML:'Mali',BF:'Burkina Faso',NE:'Niger',TD:'Chad',
    SS:'South Sudan',CF:'Central African Rep.',GN:'Guinea',ZR:'DR Congo',
    RW:'Rwanda',BI:'Burundi',MW:'Malawi',ZI:'Zimbabwe',MR:'Mauritania',
    GM:'Gambia',GW:'Guinea-Bissau',SL:'Sierra Leone',GQ:'Eq. Guinea',
    TG:'Togo',BJ:'Benin',DJ:'Djibouti',ER:'Eritrea',KM:'Comoros',
    SC:'Seychelles',MU:'Mauritius',SZ:'Eswatini',LS:'Lesotho',BW:'Botswana',
    ZB:'Zambia',TN:'Tunisia',LB:'Lebanon',PS:'Palestine',OM:'Oman',
    YU:'Yugoslavia',SK:'Slovakia',SI:'Slovenia',EE:'Estonia',LV:'Latvia',
    LT:'Lithuania',FO:'Faroe Islands',IS:'Iceland',MT:'Malta',AL:'Albania',
    MK:'N. Macedonia',XK:'Kosovo',LI:'Liechtenstein',MC:'Monaco',SM:'San Marino',
    VA:'Vatican',AD:'Andorra',GI:'Gibraltar',JE:'Jersey',GG:'Guernsey',IM:'Isle of Man',
    HK:'Hong Kong',MO:'Macau',TW:'Taiwan',SG:'Singapore',BN:'Brunei',
    TL:'Timor-Leste',MY:'Malaysia',MV:'Maldives',BT:'Bhutan',PW:'Palau',
    FM:'Micronesia',MH:'Marshall Islands',NR:'Nauru',TV:'Tuvalu',TO:'Tonga',
    WS:'Samoa',FJ:'Fiji',VU:'Vanuatu',SB:'Solomon Islands',KI:'Kiribati',
    PF:'French Polynesia',GU:'Guam',AS:'American Samoa',CK:'Cook Islands',
    NF:'Norfolk Island',CC:'Cocos Islands',CX:'Christmas Island',
    BB:'Barbados',LC:'St. Lucia',VC:'St. Vincent',GD:'Grenada',
    AG:'Antigua',KN:'St. Kitts',DM:'Dominica',TT:'Trinidad',
    BS:'Bahamas',TC:'Turks & Caicos',KY:'Cayman Islands',VG:'British Virgin Islands',
    VI:'US Virgin Islands',AW:'Aruba',CW:'Curacao',BQ:'Bonaire',SX:'Sint Maarten',
    MX:'Mexico',BZ:'Belize',GY:'Guyana',SR:'Suriname',GF:'French Guiana',
    PY:'Paraguay',FK:'Falkland Islands',GL:'Greenland',PM:'St. Pierre',
    MF:'St. Martin',BL:'St. Barthélemy',GP:'Guadeloupe',MQ:'Martinique',RE:'Réunion',
    YT:'Mayotte',TF:'French S. Territories',CG:'Republic of Congo',AO:'Angola',
    GQ:'Eq. Guinea',ST:'São Tomé',CV:'Cape Verde',GW:'Guinea-Bissau',EH:'W. Sahara',
    LY:'Libya',SD:'Sudan',JO:'Jordan',SY:'Syria',LB:'Lebanon',CY:'Cyprus',
    TR:'Turkey',GE:'Georgia',AM:'Armenia',AZ:'Azerbaijan',KZ:'Kazakhstan',
    UZ:'Uzbekistan',TM:'Turkmenistan',KG:'Kyrgyzstan',TJ:'Tajikistan',AF:'Afghanistan',
    PK:'Pakistan',IN:'India',NP:'Nepal',BT:'Bhutan',BD:'Bangladesh',LK:'Sri Lanka',
    MM:'Myanmar',TH:'Thailand',LA:'Laos',KH:'Cambodia',VN:'Vietnam',MY:'Malaysia'
  };

  var CC_CENTROIDS = {AF:[67.7,33.9],AL:[20.2,41.2],DZ:[2.6,28.0],AO:[17.9,-11.2],
    AR:[-63.6,-38.4],AU:[133.8,-25.3],AT:[14.6,47.7],BD:[90.4,23.7],BE:[4.5,50.5],
    BO:[-64.7,-17.0],BR:[-51.9,-14.2],BG:[25.5,42.7],MM:[96.7,16.9],KH:[104.9,12.6],
    CM:[12.4,5.7],CA:[-96.8,56.1],LK:[80.8,7.9],CL:[-71.5,-35.7],CN:[104.2,35.9],
    CO:[-74.3,4.6],CD:[23.7,-2.9],CR:[-84.2,9.7],HR:[16.4,45.1],CU:[-79.5,21.5],
    CY:[33.4,35.1],CZ:[15.5,49.8],DK:[9.5,56.3],DO:[-70.2,18.7],EC:[-78.1,-1.8],
    EG:[30.8,26.8],SV:[-88.9,13.8],ET:[40.5,9.1],FI:[26.3,64.0],FR:[2.2,46.2],
    GA:[11.6,-0.8],DE:[10.5,51.2],GH:[-1.0,7.9],GR:[21.8,39.1],GT:[-90.2,15.8],
    HT:[-73.0,18.9],HN:[-86.2,15.2],HU:[19.5,47.2],IN:[78.7,20.6],ID:[113.9,-0.8],
    IR:[53.7,32.4],IQ:[43.7,33.2],IE:[-8.2,53.4],IL:[34.9,31.5],IT:[12.6,42.8],
    JM:[-77.3,18.1],JP:[138.3,36.2],JO:[36.2,31.2],KE:[37.9,0.0],KP:[127.5,40.3],
    KR:[127.8,35.9],KW:[47.5,29.3],LA:[102.5,17.9],LB:[35.9,33.9],LR:[-9.4,6.4],
    LY:[17.2,26.3],LU:[6.1,49.8],MX:[-102.6,23.6],MA:[-7.1,31.8],MZ:[35.5,-18.7],
    NA:[18.5,-22.3],NP:[84.1,28.4],NL:[5.3,52.1],NZ:[172.8,-41.5],NI:[-85.0,12.9],
    NG:[8.7,9.1],NO:[8.5,60.5],PK:[69.3,30.4],PA:[-80.1,8.5],PG:[143.9,-6.3],
    PE:[-75.0,-9.2],PH:[122.9,12.9],PL:[19.1,52.1],PT:[-8.2,39.6],QA:[51.2,25.4],
    RO:[24.9,45.9],RU:[99.0,61.5],SA:[44.5,24.0],SN:[-14.5,14.5],SO:[46.2,5.2],
    ZA:[25.1,-29.0],ES:[-3.7,40.2],SD:[29.9,12.9],SE:[18.6,60.1],CH:[8.2,46.8],
    SY:[38.0,35.0],TH:[101.0,15.9],TR:[35.2,39.1],UG:[32.3,1.4],UA:[31.2,48.4],
    AE:[53.8,23.4],GB:[-3.4,55.4],US:[-100.4,37.1],UY:[-55.8,-32.5],VE:[-66.6,6.4],
    VN:[108.3,14.1],YE:[47.6,15.6],ZM:[27.8,-13.1],ZW:[29.9,-19.0],BA:[17.2,44.2],
    RS:[21.0,44.0],BY:[28.0,53.5],GE:[43.4,42.3],KZ:[66.9,48.0],MN:[103.8,46.9]};

  function iso2Flag(cc){
    if(!cc||cc.length!==2)return'';
    return cc.split('').map(function(c){
      return String.fromCodePoint(0x1F1E6-65+c.toUpperCase().charCodeAt(0));
    }).join('');
  }

  function project(lon,lat){
    return [(lon+180)*(W/360), (90-lat)*(H/180)];
  }

  function computeCentroid(feature){
    // Use CC_CENTROIDS if available, else rough bbox centre from geometry
    var cc = feature._cc;
    if(CC_CENTROIDS[cc]) return project(CC_CENTROIDS[cc][0], CC_CENTROIDS[cc][1]);
    var coords = [];
    function gather(ring){ ring.forEach(function(p){ coords.push(p); }); }
    if(feature.geometry.type==='Polygon') feature.geometry.coordinates.forEach(gather);
    else if(feature.geometry.type==='MultiPolygon')
      feature.geometry.coordinates.forEach(function(poly){ poly.forEach(gather); });
    if(!coords.length) return null;
    var lon=0,lat=0;
    coords.forEach(function(p){lon+=p[0];lat+=p[1];});
    return project(lon/coords.length, lat/coords.length);
  }

  function coordsToD(coords){
    return coords.map(function(ring){
      var d='';
      for(var i=0;i<ring.length;i++){
        var p=project(ring[i][0],ring[i][1]);
        if(i===0){
          d+='M'+p[0].toFixed(1)+','+p[1].toFixed(1);
        } else {
          // Detect antimeridian jump (>180 degrees lon diff) — move instead of line
          var dlon=Math.abs(ring[i][0]-ring[i-1][0]);
          if(dlon>180){
            d+='M'+p[0].toFixed(1)+','+p[1].toFixed(1);
          } else {
            d+=' L'+p[0].toFixed(1)+','+p[1].toFixed(1);
          }
        }
      }
      return d+'Z';
    }).join(' ');
  }

  function makeArcD(x1,y1,x2,y2){
    var dx=x2-x1, dy=y2-y1;
    var dist=Math.sqrt(dx*dx+dy*dy);
    var cx=(x1+x2)/2, cy=(y1+y2)/2;
    // Control point rises proportionally above midpoint
    var rise = Math.max(40, dist*0.35);
    var nx=-dy/dist, ny=dx/dist; // perpendicular unit
    // Always arch upward (negative y = up in SVG)
    if(ny>0){nx=-nx;ny=-ny;}
    var cpx=cx+nx*rise, cpy=cy+ny*rise;
    return 'M'+x1.toFixed(1)+','+y1.toFixed(1)+
           ' Q'+cpx.toFixed(1)+','+cpy.toFixed(1)+
           ' '+x2.toFixed(1)+','+y2.toFixed(1);
  }

  function updateArcs(counts){
    if(!_arcLayer) return;
    var src = _centroids[_localCC];
    // Remove old arcs not in current counts
    Object.keys(_arcEls).forEach(function(cc){
      if(!counts[cc] && _arcEls[cc]){
        _arcEls[cc].parentNode && _arcEls[cc].parentNode.removeChild(_arcEls[cc]);
        delete _arcEls[cc];
      }
    });
    if(!src) return;
    var max=0; Object.keys(counts).forEach(function(k){if(counts[k]>max)max=counts[k];});
    Object.keys(counts).forEach(function(cc){
      if(cc===_localCC) return;
      var dst = _centroids[cc]; if(!dst) return;
      var hot = counts[cc]>=max*0.5;
      var arcD = makeArcD(src[0],src[1],dst[0],dst[1]);
      // Only recreate if path changed or doesn't exist
      var existing = _arcEls[cc];
      var arcPath = existing ? existing.querySelector('path') : null;
      if(!existing || (arcPath && arcPath.getAttribute('d')!==arcD)){
        if(existing) existing.parentNode && existing.parentNode.removeChild(existing);
        // Group: arc path + animated comet dot
        var g = document.createElementNS('http://www.w3.org/2000/svg','g');
        var path = document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d', arcD);
        path.setAttribute('class','map-arc'+(hot?' hot':''));
        // Comet dot with animateMotion — randomised start offset so dots
        // don't all depart simultaneously
        var dur = hot ? '1.4s' : '2.2s';
        var durSecs = hot ? 1.4 : 2.2;
        // Vary duration slightly per country so loops desync over time
        var jitter = (Math.random() * 0.6 - 0.3);
        var finalDur = Math.max(0.8, durSecs + jitter).toFixed(2)+'s';
        var beginDelay = -(Math.random() * durSecs).toFixed(2)+'s';
        var circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
        circle.setAttribute('r', hot ? '3' : '2');
        circle.setAttribute('class','map-comet'+(hot?' hot':''));
        var anim = document.createElementNS('http://www.w3.org/2000/svg','animateMotion');
        anim.setAttribute('dur', finalDur);
        anim.setAttribute('repeatCount','indefinite');
        anim.setAttribute('begin', beginDelay);
        anim.setAttribute('path', arcD);
        circle.appendChild(anim);
        g.appendChild(path);
        g.appendChild(circle);
        _arcLayer.appendChild(g);
        _arcEls[cc] = g;
      }
    });
  }

  function updateLabels(counts){
    if(!_labelLayer) return;
    var max=0; Object.keys(counts).forEach(function(k){if(counts[k]>max)max=counts[k];});
    // Remove stale labels
    Object.keys(_labelEls).forEach(function(cc){
      if(!counts[cc]){ _labelEls[cc].textContent=''; }
    });
    Object.keys(counts).forEach(function(cc){
      var c=_centroids[cc]; if(!c) return;
      var el=_labelEls[cc];
      if(!el){
        el=document.createElementNS('http://www.w3.org/2000/svg','text');
        el.setAttribute('class','map-label');
        _labelLayer.appendChild(el);
        _labelEls[cc]=el;
      }
      el.setAttribute('x',c[0].toFixed(1));
      el.setAttribute('y',(c[1]-6).toFixed(1));
      el.textContent=counts[cc];
    });
  }

  function updateHighlights(counts){
    var max=0; Object.keys(counts).forEach(function(k){if(counts[k]>max)max=counts[k];});
    Object.keys(_pathEls).forEach(function(cc){
      var el=_pathEls[cc], n=counts[cc]||0;
      el.classList.remove('active','hot');
      if(n>0){ el.classList.add(n>=max*0.5?'hot':'active'); }
    });
  }

  // Sparklines: tiny 40x14 canvas per country, last 20 data points
  var SPARK_LEN=20;
  function pushSpark(cc, val){
    if(!_sparkData[cc]) _sparkData[cc]=[];
    _sparkData[cc].push(val);
    if(_sparkData[cc].length>SPARK_LEN) _sparkData[cc].shift();
  }
  function drawSparkSVG(data){
    if(!data||data.length<2) return '';
    var max=Math.max.apply(null,data)||1;
    var w=50,h=12;
    var pts=data.map(function(v,i){
      return (i*(w/(data.length-1))).toFixed(1)+','+(h-(v/max*(h-2))-1).toFixed(1);
    }).join(' ');
    return '<svg class="conn-sparkline" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'+
      '<polyline points="'+pts+'" fill="none" stroke="rgba(56,189,248,.6)" stroke-width="1.2" stroke-linejoin="round"/>'+
      '</svg>';
  }

  function renderPortList(topPorts){
    var el=$('connPortList'); if(!el) return;
    if(!topPorts||!topPorts.length){el.innerHTML='<div class="empty-state">—</div>';return;}
    var max=topPorts[0].count||1;
    el.innerHTML=topPorts.map(function(p){
      var pct=Math.round((p.count/max)*100);
      var name=PORT_NAMES[p.port]||'';
      return '<div class="conn-port-row">'+
        '<span class="conn-port-num">'+p.port+'</span>'+
        '<span class="conn-port-name">'+name+'</span>'+
        '<div class="conn-port-bar" style="width:'+Math.max(4,pct)+'px"></div>'+
        '<span class="conn-port-count">'+p.count+'</span>'+
      '</div>';
    }).join('');
  }

  function renderCountryList(topCountries, selectedCC){
    var list=$('connMapList'); if(!list) return;
    var sub=$('connMapSub');
    if(!topCountries||!topCountries.length){
      list.innerHTML='<div class="empty-state">No geo data yet</div>'; return;
    }
    if(sub) sub.textContent=topCountries.length+' countries active';
    list.innerHTML=topCountries.map(function(e){
      var flag=iso2Flag(e.cc);
      var total=(e.proto.tcp||0)+(e.proto.udp||0)+(e.proto.other||0)||1;
      var tcpPct=Math.round((e.proto.tcp||0)/total*100);
      var udpPct=Math.round((e.proto.udp||0)/total*100);
      var othPct=100-tcpPct-udpPct;
      var spark=drawSparkSVG(_sparkData[e.cc]);
      var sel=(e.cc===selectedCC);
      return '<div class="conn-map-row'+(sel?' selected':'')+'" data-cc="'+e.cc+'">'+
        '<span class="conn-map-flag">'+flag+'</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div class="conn-map-label">'+(CC_NAMES[e.cc]||e.cc)+(e.city?' <span class="conn-map-label-sub">'+esc(e.city)+'</span>':'')+'</div>'+
          '<div class="conn-proto-bar">'+
            '<div class="conn-proto-tcp" style="flex:'+tcpPct+'"></div>'+
            '<div class="conn-proto-udp" style="flex:'+udpPct+'"></div>'+
            '<div class="conn-proto-other" style="flex:'+othPct+'"></div>'+
          '</div>'+
          spark+
        '</div>'+
    '<span class="conn-map-count">'+e.count+'</span>'+
        '<button class="conn-row-info" title="Show connections" style="background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:4px;padding:.1rem .4rem;font-size:.68rem;cursor:pointer;margin-left:.4rem;flex-shrink:0">⋯</button>'+
      '</div>';
    }).join('');

    // Re-bind click handlers for filter
    list.querySelectorAll('.conn-map-row').forEach(function(row){
      row.addEventListener('click',function(e){
        var cc=row.dataset.cc;
        if(e.target.closest('.conn-row-info')){
          var flag=iso2Flag(cc);
          var name=CC_NAMES[cc]||cc;
          if(typeof window.showCountryModal==='function') window.showCountryModal(cc, name, flag);
          return;
        }
        _selectedCC=(cc===_selectedCC)?null:cc;
        var lbl=$('connFilterLabel');
        if(lbl) lbl.style.display=_selectedCC?'':'none';
        renderCountryList(topCountries, _selectedCC);
        // Highlight only selected on map
        if(_selectedCC){
          Object.keys(_pathEls).forEach(function(c){
            _pathEls[c].classList.remove('active','hot');
            if(c===_selectedCC) _pathEls[c].classList.add('hot');
          });
        } else {
          updateHighlights(_countryCounts);
        }
      });
    });
  }

  // Tooltip on country hover
  function bindTooltip(){
    mapEl.addEventListener('mousemove',function(e){
      var tgt=e.target; if(!tgt.dataset||!tgt.dataset.cc) return;
      var cc=tgt.dataset.cc;
      var n=_countryCounts[cc]||0;
      if(!n&&!_pathEls[cc]) return;
      var flag=iso2Flag(cc);
      var city=_countryCity[cc]||'';
      var proto=_countryProto[cc]||{};
      tooltipEl.innerHTML=flag+' <strong>'+(CC_NAMES[cc]||cc)+'</strong>'+(city?' · '+esc(city):'')+
        (n?' &nbsp;<span style="color:var(--accent-rx)">'+n+' conns</span>':'')+
        (proto.tcp||proto.udp?'<br><span style="color:var(--text-muted);font-size:.6rem">TCP:'+
          (proto.tcp||0)+' UDP:'+(proto.udp||0)+'</span>':'');
      var wrap=mapEl.parentElement.getBoundingClientRect();
      var tx=e.clientX-wrap.left+10, ty=e.clientY-wrap.top-30;
      tooltipEl.style.left=tx+'px'; tooltipEl.style.top=ty+'px';
      tooltipEl.style.display='block';
    });
    mapEl.addEventListener('mouseleave',function(){
      tooltipEl.style.display='none';
    });
  }

  // Load map
  fetch(MAP_URL).then(function(r){return r.json();}).then(function(world){
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js';
    s.onload=function(){
      var countries=topojson.feature(world,world.objects.countries);

      // SVG layers: countries, arcs on top, labels on top of arcs
      var countryLayer=document.createElementNS('http://www.w3.org/2000/svg','g');
      _arcLayer=document.createElementNS('http://www.w3.org/2000/svg','g');
      _labelLayer=document.createElementNS('http://www.w3.org/2000/svg','g');
      mapEl.appendChild(countryLayer);
      mapEl.appendChild(_arcLayer);
      mapEl.appendChild(_labelLayer);

      var frag=document.createDocumentFragment();
      countries.features.forEach(function(f){
        var numId=parseInt(f.id,10);
        var cc=NUM_TO_ISO2[numId]||('N'+f.id);
        f._cc=cc;
        var d='';
        if(f.geometry.type==='Polygon') d=coordsToD(f.geometry.coordinates);
        else if(f.geometry.type==='MultiPolygon')
          f.geometry.coordinates.forEach(function(p){d+=coordsToD(p);});
        if(!d) return;
        var path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',d);
        path.setAttribute('class','map-country');
        path.setAttribute('data-cc',cc);
        _pathEls[cc]=path;
        var c=computeCentroid(f);
        if(c) _centroids[cc]=c;
        frag.appendChild(path);
      });
      countryLayer.appendChild(frag);
      bindTooltip();

  // ── Map zoom / pan ────────────────────────────────────────────────────────
  (function(){
    var wrap = $('worldMapWrap');
    var svg  = mapEl;
    if(!wrap||!svg) return;

    var scale=1, tx=0, ty=0;
    var MIN_SCALE=1, MAX_SCALE=8;
    var dragging=false, dragStartX=0, dragStartY=0, dragTx=0, dragTy=0;

    function clampTranslate(s,x,y){
      // Allow panning only within bounds at current scale
      var svgW=svg.clientWidth||1000, svgH=svg.clientHeight||500;
      var maxX=(s-1)*svgW, maxY=(s-1)*svgH;
      return [Math.max(-maxX,Math.min(0,x)), Math.max(-maxY,Math.min(0,y))];
    }

    function applyTransform(){
      var cl=clampTranslate(scale,tx,ty); tx=cl[0]; ty=cl[1];
      svg.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';
      svg.style.transformOrigin='0 0';
      wrap.style.cursor=scale>1?'grab':'default';
    }

    function zoomAt(factor, cx, cy){
      var newScale=Math.max(MIN_SCALE,Math.min(MAX_SCALE,scale*factor));
      if(newScale===scale) return;
      // Zoom toward cursor point
      tx = cx - (cx-tx)*(newScale/scale);
      ty = cy - (cy-ty)*(newScale/scale);
      scale=newScale;
      applyTransform();
    }

    // Mouse wheel zoom
    wrap.addEventListener('wheel',function(e){
      e.preventDefault();
      var rect=wrap.getBoundingClientRect();
      var cx=e.clientX-rect.left, cy=e.clientY-rect.top;
      var factor=e.deltaY<0?1.15:1/1.15;
      zoomAt(factor,cx,cy);
    },{passive:false});

    // Drag pan
    wrap.addEventListener('mousedown',function(e){
      if(scale<=1) return;
      dragging=true; dragStartX=e.clientX; dragStartY=e.clientY;
      dragTx=tx; dragTy=ty;
      wrap.style.cursor='grabbing';
      e.preventDefault();
    });
    window.addEventListener('mousemove',function(e){
      if(!dragging) return;
      tx=dragTx+(e.clientX-dragStartX);
      ty=dragTy+(e.clientY-dragStartY);
      applyTransform();
    });
    window.addEventListener('mouseup',function(){
      dragging=false;
      wrap.style.cursor=scale>1?'grab':'default';
    });

    // Touch pinch zoom + drag — binds to whichever container currently holds the SVG
    var touches={}, lastDist=null;
    var _touchTarget=wrap;  // updated to fsOverlay when fullscreen is active

    function onTouchStart(e){
      Array.from(e.changedTouches).forEach(function(t){ touches[t.identifier]=t; });
      if(Object.keys(touches).length===1){
        var t=Object.values(touches)[0];
        dragging=true; dragStartX=t.clientX; dragStartY=t.clientY;
        dragTx=tx; dragTy=ty;
      }
      e.preventDefault();
    }
    function onTouchMove(e){
      Array.from(e.changedTouches).forEach(function(t){ touches[t.identifier]=t; });
      var pts=Object.values(touches);
      if(pts.length===2){
        var dx=pts[0].clientX-pts[1].clientX, dy=pts[0].clientY-pts[1].clientY;
        var dist=Math.sqrt(dx*dx+dy*dy);
        if(lastDist!==null){
          var rect=_touchTarget.getBoundingClientRect();
          var cx=(pts[0].clientX+pts[1].clientX)/2-rect.left;
          var cy=(pts[0].clientY+pts[1].clientY)/2-rect.top;
          zoomAt(dist/lastDist,cx,cy);
        }
        lastDist=dist;
      } else if(pts.length===1 && dragging){
        var t2=pts[0];
        tx=dragTx+(t2.clientX-dragStartX);
        ty=dragTy+(t2.clientY-dragStartY);
        applyTransform();
      }
      e.preventDefault();
    }
    function onTouchEnd(e){
      Array.from(e.changedTouches).forEach(function(t){ delete touches[t.identifier]; });
      lastDist=null;
      if(!Object.keys(touches).length) dragging=false;
    }
    function bindTouch(el){
      el.addEventListener('touchstart',onTouchStart,{passive:false});
      el.addEventListener('touchmove',onTouchMove,{passive:false});
      el.addEventListener('touchend',onTouchEnd);
    }
    function unbindTouch(el){
      el.removeEventListener('touchstart',onTouchStart);
      el.removeEventListener('touchmove',onTouchMove);
      el.removeEventListener('touchend',onTouchEnd);
    }
    bindTouch(wrap);

    // Fullscreen — portal the SVG into a body-level overlay to escape stacking contexts
    var fsBtn=$('mapFullscreenBtn');
    var fsOverlay=$('mapFsOverlay');
    var fsClose=$('mapFsClose');
    // svgPlaceholder marks where the SVG lives when not in fullscreen
    var svgPlaceholder=document.createComment('map-svg-placeholder');

    function isMobile(){ return window.innerWidth<=767; }
    function setFsBtnVisible(){ if(fsBtn) fsBtn.style.display=isMobile()?'flex':'none'; }
    setFsBtnVisible();
    window.addEventListener('resize',setFsBtnVisible);

    function openMapFs(){
      if(!fsOverlay||!svg) return;
      unbindTouch(wrap);
      svg.parentNode.insertBefore(svgPlaceholder, svg);
      fsOverlay.appendChild(svg);
      fsOverlay.classList.add('active');
      _touchTarget=fsOverlay;
      bindTouch(fsOverlay);
      document.body.style.overflow='hidden';
      document.addEventListener('keydown',onFsKey);
    }
    function closeMapFs(){
      if(!fsOverlay||!svg) return;
      unbindTouch(fsOverlay);
      svgPlaceholder.parentNode.insertBefore(svg, svgPlaceholder);
      svgPlaceholder.parentNode.removeChild(svgPlaceholder);
      fsOverlay.classList.remove('active');
      _touchTarget=wrap;
      bindTouch(wrap);
      document.body.style.overflow='';
      document.removeEventListener('keydown',onFsKey);
    }
    function onFsKey(e){ if(e.key==='Escape') closeMapFs(); }

    if(fsBtn) fsBtn.addEventListener('click', openMapFs);
    if(fsClose) fsClose.addEventListener('click', closeMapFs);
    // Zoom buttons
    var btnIn=$('mapZoomIn'), btnOut=$('mapZoomOut'), btnReset=$('mapZoomReset');
    if(btnIn)    btnIn.addEventListener('click',function(){ var c=svg.clientWidth/2; zoomAt(1.5,c,svg.clientHeight/2); });
    if(btnOut)   btnOut.addEventListener('click',function(){ var c=svg.clientWidth/2; zoomAt(1/1.5,c,svg.clientHeight/2); });
    if(btnReset) btnReset.addEventListener('click',function(){ scale=1;tx=0;ty=0; applyTransform(); });
  })();

      // Apply pending data
      if(Object.keys(_countryCounts).length){
        updateHighlights(_countryCounts);
        updateArcs(_countryCounts);
        updateLabels(_countryCounts);
      }
    };
    document.head.appendChild(s);
  }).catch(function(e){console.warn('[worldmap]',e);});

  // conn:update handler
  socket.on('conn:update',function(data){
    var topCountries=data.topCountries||[];
    // Detect which countries gained connections vs last poll
    var prevCounts=_countryCounts;
    // Update caches
    topCountries.forEach(function(e){
      _countryProto[e.cc]=e.proto||{};
      _countryCity[e.cc]=e.city||'';
      pushSpark(e.cc, e.count);
    });
    // Rebuild counts from topCountries
    var counts={};
    topCountries.forEach(function(e){ counts[e.cc]=e.count; });
    _countryCounts=counts;
    // Pulse countries that gained new connections
    if(data.newSinceLast>0){
      Object.keys(counts).forEach(function(cc){
        if((counts[cc]||0)>(prevCounts[cc]||0)){
          var el=_pathEls[cc]; if(!el) return;
          el.classList.remove('pulse');
          // Force reflow to restart animation
          void el.getBoundingClientRect();
          el.classList.add('pulse');
          setTimeout(function(){ el.classList.remove('pulse'); }, 750);
        }
      });
    }

    // Detect local country from first WAN IP or fall back
    // Use the most connected country as a proxy for "not local"
    // Actually detect via the topSources country — use router WAN IP geo
    // For now if we don't know local CC, try to detect from dest list exclusion
    // Fetch local country from server (WAN IP geo lookup)
  fetch('/api/localcc').then(function(r){return r.json();}).then(function(d){
    if(d.cc){ _localCC=d.cc; updateArcs(_countryCounts); }
  }).catch(function(){});

    updateHighlights(counts);
    updateArcs(counts);
    updateLabels(counts);
    renderCountryList(topCountries, _selectedCC);
    renderPortList(data.topPorts||[]);
  });
})();

// ── Country connections modal ────────────────────────────────────────────────
(function(){
  var modal    = $('countryModal');
  var closeBtn = $('countryModalClose');
  var _ccConns = {};

  // Store conns data when conn:update arrives
  socket.on('conn:update', function(data){
    (data.topCountries||[]).forEach(function(e){
      if (e.conns) _ccConns[e.cc] = e.conns;
    });
  });

  window.showCountryModal = function(cc, name, flag) {
    var conns = _ccConns[cc] || [];
    $('countryModalFlag').textContent  = flag || '';
    $('countryModalTitle').textContent = name || cc;
    $('countryModalCount').textContent = conns.length + ' connections shown';
    var tbody = $('countryModalTable');
    if (!conns.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No connection details available</td></tr>';
    } else {
      tbody.innerHTML = conns.map(function(c){
        return '<tr>'+
          '<td style="font-family:var(--font-mono);font-size:.72rem">'+esc(c.src)+'</td>'+
          '<td style="font-family:var(--font-mono);font-size:.72rem">'+esc(c.dst)+'</td>'+
          '<td style="font-family:var(--font-mono);font-size:.72rem">'+esc(c.port)+'</td>'+
          '<td><span style="font-size:.68rem;padding:.1rem .35rem;border-radius:3px;background:rgba(99,130,190,.15)">'+esc(c.proto)+'</span></td>'+
        '</tr>';
      }).join('');
    }
    modal.style.display = 'flex';
  };

  if (closeBtn) closeBtn.addEventListener('click', function(){ modal.style.display = 'none'; });
  modal.addEventListener('click', function(e){ if(e.target === modal) modal.style.display = 'none'; });
})();

// ── Mobile burger menu ──────────────────────────────────────────────
(function(){
  var burger  = $('burgerBtn');
  var sidenav = $('sidenav');
  var overlay = $('navOverlay');
  if(!burger||!sidenav) return;
  function openNav(){sidenav.classList.add('mobile-open');overlay.classList.add('show');}
  function closeNav(){sidenav.classList.remove('mobile-open');overlay.classList.remove('show');}
  burger.addEventListener('click', openNav);
  overlay.addEventListener('click', closeNav);
  document.querySelectorAll('.nav-item').forEach(function(item){
    item.addEventListener('click', function(){
      if(window.innerWidth<=767) closeNav();
    });
  });
})();

// ── User Management ─────────────────────────────────────────────────────────
(function(){
  // ── Permission bootstrap ─────────────────────────────────────────────────
  fetch('/api/me', { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(me){
      window._currentUser = me;
      var perms = me.permissions || {};
      if (window._onMeLoaded) window._onMeLoaded(me);
      dhcpCanWrite = !!(perms.dhcp && perms.dhcp.write);
      switchCanWrite = !!(perms.switches && perms.switches.write);
      if (allLeases && allLeases.length) renderDhcp(allLeases);

      // Show/hide nav items based on read permissions
      var navMap = {
        'interfaces':   'data-page="interfaces"',
        'dhcp':         'data-page="dhcp"',
        'vpn':          'data-page="vpn"',
        'connections':  'data-page="connections"',
        'switches':     'data-page="switches"',
        'routes':       'data-page="routes"',
        'addresslists': 'data-page="addresslists"',
        'firewall':     'data-page="firewall"',
        'logs':         'data-page="logs"',
        'users':        'data-page="users"',
      };
      Object.keys(navMap).forEach(function(key){
        var el = document.querySelector('.nav-item['+navMap[key]+']');
        if (!el) return;
        el.style.display = (perms[key] && perms[key].read) ? '' : 'none';
      });

      // Redirect away from pages user can't read
      var currentPage = window.location.hash.replace('#','') || 'dashboard';
      if (currentPage !== 'dashboard' && currentPage !== 'about') {
        if (!perms[currentPage] || !perms[currentPage].read) showPage('dashboard');
      }
    }).catch(function(){});

  // ── Users page ───────────────────────────────────────────────────────────
  var _pages = [];
  var _users = [];

  function canWrite() {
    var me = window._currentUser;
    return me && me.permissions && me.permissions.users && me.permissions.users.write;
  }

  window.loadUsers = function() {
    Promise.all([
      fetch('/api/users', { credentials: 'include' }).then(function(r){ return r.json(); }),
      fetch('/api/pages', { credentials: 'include' }).then(function(r){ return r.json(); }),
    ]).then(function(results){
      _users = results[0];
      _pages = results[1];
      renderUsersPage();
    }).catch(function(){
      var c = $('usersPermissionsContainer');
      if (c) c.innerHTML = '<div class="empty-state">Failed to load users</div>';
    });
  };

  function renderUsersPage() {
    var container = $('usersPermissionsContainer');
    if (!container) return;
    if (!_users.length) {
      container.innerHTML = '<div class="card"><div class="card-body empty-state">No users found</div></div>';
      return;
    }

    container.innerHTML = _users.map(function(u){
      var created = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—';
      var perms   = u.permissions || {};
      var write   = canWrite();

      // Permission grid rows
      var permRows = _pages.map(function(p){
        var perm     = perms[p.key] || { read: false, write: false };
        var readChk  = '<label style="display:flex;align-items:center;gap:.3rem;cursor:'+(write?'pointer':'default')+';font-size:.75rem">'+
          '<input type="checkbox" data-user="'+esc(u.username)+'" data-page="'+esc(p.key)+'" data-type="read" '+(perm.read?'checked':'')+' '+(write?'':'disabled')+' style="cursor:'+(write?'pointer':'default')+'"> Read</label>';
        var writeChk = '<label style="display:flex;align-items:center;gap:.3rem;cursor:'+(write?'pointer':'default')+';font-size:.75rem">'+
          '<input type="checkbox" data-user="'+esc(u.username)+'" data-page="'+esc(p.key)+'" data-type="write" '+(perm.write?'checked':'')+' '+(write?'':'disabled')+' style="cursor:'+(write?'pointer':'default')+'"> Write</label>';
        return '<tr>'+
          '<td style="font-size:.8rem;color:var(--text-muted)">'+esc(p.label)+'</td>'+
          '<td>'+readChk+'</td>'+
          '<td>'+writeChk+'</td>'+
        '</tr>';
      }).join('');

      var actions = write
        ? '<div style="display:flex;gap:.4rem;margin-top:.75rem">'+
            '<button onclick="window._chgPwd(\''+esc(u.username)+'\')" style="background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:4px;padding:.2rem .5rem;font-size:.72rem;cursor:pointer">Change Password</button>'+
            '<button onclick="window._delUser(\''+esc(u.username)+'\')" style="background:transparent;border:1px solid rgba(248,113,113,.3);color:#f87171;border-radius:4px;padding:.2rem .5rem;font-size:.72rem;cursor:pointer">Delete User</button>'+
          '</div>'
        : '';

      return '<div class="card mb-3">'+
        '<div class="card-header d-flex align-items-center justify-content-between">'+
          '<div>'+
            '<span style="font-family:var(--font-mono);font-weight:600">'+esc(u.username)+'</span>'+
            '<span style="font-size:.72rem;color:var(--text-muted);margin-left:.75rem">Created '+created+'</span>'+
          '</div>'+
        '</div>'+
        '<div class="card-body p-0">'+
          '<table class="table table-vcenter mb-0" style="font-size:.8rem">'+
            '<thead><tr><th style="width:30%">Page</th><th style="width:35%">Read</th><th style="width:35%">Write</th></tr></thead>'+
            '<tbody>'+permRows+'</tbody>'+
          '</table>'+
          (write ? '<div style="padding:.75rem 1rem;border-top:1px solid var(--border)">'+actions+'</div>' : '')+
        '</div>'+
      '</div>';
    }).join('');

    // Wire up permission checkboxes
    if (canWrite()) {
      container.querySelectorAll('input[type="checkbox"][data-user]').forEach(function(cb){
        cb.addEventListener('change', function(){
          var username = cb.dataset.user;
          var pageKey  = cb.dataset.page;
          var type     = cb.dataset.type;
          var user     = _users.find(function(u){ return u.username === username; });
          if (!user) return;
          var perms = user.permissions || {};
          var perm  = Object.assign({ read: false, write: false }, perms[pageKey] || {});

          if (type === 'read') {
            perm.read = cb.checked;
            if (!perm.read) perm.write = false; // can't write without read
          } else {
            perm.write = cb.checked;
            if (perm.write) perm.read = true; // write implies read
          }

          // Update local state
          if (!user.permissions) user.permissions = {};
          user.permissions[pageKey] = perm;

          // Sync read checkbox if write was toggled
          var readCb = container.querySelector('input[data-user="'+username+'"][data-page="'+pageKey+'"][data-type="read"]');
          if (readCb) readCb.checked = perm.read;
          var writeCb = container.querySelector('input[data-user="'+username+'"][data-page="'+pageKey+'"][data-type="write"]');
          if (writeCb) writeCb.checked = perm.write;

          // Save to server
          secureApiCall('/api/permissions', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, pageKey, canRead: perm.read, canWrite: perm.write })
          }).catch(function(){ console.error('Failed to save permission'); });
        });
      });
    }
  }

  // Add user form toggle
  var showAddBtn = $('showAddUser');
  if (showAddBtn) showAddBtn.addEventListener('click', function(){
    var f = $('addUserForm');
    if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
  });

  // Submit new user
  var submitBtn = $('submitAddUser');
  if (submitBtn) submitBtn.addEventListener('click', function(){
    var username = $('newUsername').value.trim();
    var password = $('newPassword').value;
    var errEl    = $('addUserError');
    if (!username || !password) { errEl.textContent='Username and password required'; errEl.style.display='block'; return; }
    secureApiCall('/api/users', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(function(r){ return r.json(); }).then(function(d){
      if (d.error) { errEl.textContent=d.error; errEl.style.display='block'; return; }
      $('newUsername').value=''; $('newPassword').value='';
      errEl.style.display='none';
      $('addUserForm').style.display='none';
      loadUsers();
    });
  });

  // Change password modal
  window._chgPwd = function(username) {
    $('chgPwdUsername').value = username;
    $('chgPwdNew').value = '';
    $('chgPwdError').style.display = 'none';
    $('chgPwdModal').style.display = 'flex';
  };
  var cancelBtn = $('chgPwdCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', function(){ $('chgPwdModal').style.display='none'; });
  var pwdSubmit = $('chgPwdSubmit');
  if (pwdSubmit) pwdSubmit.addEventListener('click', function(){
    var username = $('chgPwdUsername').value;
    var password = $('chgPwdNew').value;
    var errEl    = $('chgPwdError');
    if (!password) { errEl.textContent='Password required'; errEl.style.display='block'; return; }
    secureApiCall('/api/users/'+username, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    }).then(function(r){ return r.json(); }).then(function(d){
      if (d.error) { errEl.textContent=d.error; errEl.style.display='block'; return; }
      $('chgPwdModal').style.display='none';
    });
  });

  // Delete user
  window._delUser = function(username) {
    if (!confirm('Delete user "'+username+'"? This cannot be undone.')) return;
    secureApiCall('/api/users/'+username, { method: 'DELETE', credentials: 'include' })
      .then(function(){ loadUsers(); });
  };

})();

// ── Switch Visualiser ─────────────────────────────────────────────────────
(function(){
  var _swData    = {};   // cache: switchName -> port array
  var _swMeta    = {};   // cache: switchName -> metadata
  var _swList    = [];   // [{name, modules}]
  var _selSwitch = '';
  var _selModule = 1;

  function updateWriteMemoryButton() {
    var btn = $('swWriteMemoryBtn');
    if (!btn) return;
    var swMeta = _swMeta[_selSwitch] || {};
    var show = !!_selSwitch && switchCanWrite && !!swMeta.writeEnabled;
    btn.style.display = show ? '' : 'none';
    btn.disabled = false;
    btn.textContent = 'Write Memory';
  }

  // Tab switching
  document.querySelectorAll('.sw-tab-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.sw-tab-btn').forEach(function(b){
        b.style.borderBottomColor = 'transparent';
        b.style.color = 'var(--text-muted)';
        b.classList.remove('active');
      });
      btn.style.borderBottomColor = 'var(--accent-rx)';
      btn.style.color = 'var(--text-main)';
      btn.classList.add('active');
      var tab = btn.dataset.tab;
      document.querySelectorAll('.sw-tab-content').forEach(function(c){ c.style.display='none'; });
      var el = $('sw-tab-'+tab);
      if (el) el.style.display = '';
      if (tab === 'visualiser') { if (!_swList.length) loadSwitchList(); }
    });
  });

  function loadSwitchList() {
    fetch('/api/switches/list', { credentials: 'include' })
      .then(function(r){ return r.json(); })
      .then(function(list){
        _swList = list;
        var sel = $('swVisSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">— Select switch —</option>' +
          list.map(function(sw){
            return '<option value="'+esc(sw.name)+'">'+esc(sw.name)+'</option>';
          }).join('');
      }).catch(function(){ console.error('Failed to load switch list'); });
  }

function loadSwitchPorts(name) {
    var diag = $('swVisDiagram');
    if (diag) diag.innerHTML = '<div class="empty-state">Loading port data…</div>';
    fetch('/api/switches/'+encodeURIComponent(name)+'/ports', { credentials: 'include' })
      .then(function(r){ return r.json(); })
      .then(function(data){
        _swData[name] = data.ports;
        _swMeta[name] = {
          vlanOptions: data.vlanOptions || [],
          routerVlans: data.routerVlans || [],
          switchVlans: data.switchVlans || [],
          defaultVlan: data.defaultVlan || null,
          writeEnabled: !!data.writeEnabled,
        };
        var ts = $('swVisLastUpdate');
        if (ts) ts.textContent = 'Updated ' + new Date(data.ts).toLocaleTimeString();

        // Update module selector from actual port data
        var modules = [...new Set(data.ports.map(function(p){ return p.module; }))].sort(function(a,b){return a-b;});
        var modSel = $('swVisModule');
        if (modSel) {
          if (modules.length > 1) {
            modSel.innerHTML = modules.map(function(m){
              return '<option value="'+m+'">Switch '+m+'</option>';
            }).join('');
            modSel.style.display = '';
          } else {
            modSel.style.display = 'none';
          }
        }
        _selModule = modules[0] || 1;
        renderVisualiser(name, _selModule);
        updateWriteMemoryButton();
      }).catch(function(){
        var diag = $('swVisDiagram');
        if (diag) diag.innerHTML = '<div class="empty-state">Failed to load port data</div>';
      });
  }

function renderVisualiser(switchName, module) {
    var diag = $('swVisDiagram');
    if (!diag) return;
    var allData = _swData[switchName] || [];
    var modules = [...new Set(allData.map(function(p){ return p.module; }))].sort(function(a,b){return a-b;});
    if (!modules.length) {
      diag.innerHTML = '<div class="empty-state">No port data for this switch</div>';
      return;
    }

    function portColor(p) {
      if (!p) return 'var(--bg-main)';
      if ((p.adminStatus || 'up') === 'down') return 'rgba(248,113,113,.16)';
      if (p.isUplink && p.status === 'up') return 'rgba(168,85,247,.2)';
      if (p.isUplink) return 'rgba(255,255,255,.05)';
      if (p.status === 'up' && p.poeStatus === 'delivering') return 'rgba(34,197,94,.25)';
      if (p.status === 'up') return 'rgba(56,189,248,.2)';
      return 'rgba(255,255,255,.05)';
    }

    function portBorder(p) {
      if (!p) return '1px solid var(--border)';
      if ((p.adminStatus || 'up') === 'down') return '1px solid rgba(248,113,113,.65)';
      if (p.isUplink && p.status === 'up') return '1px solid rgba(168,85,247,.5)';
      if (p.isUplink) return '1px solid var(--border)';
      if (p.status === 'up' && p.poeStatus === 'delivering') return '1px solid rgba(34,197,94,.6)';
      if (p.status === 'up') return '1px solid rgba(56,189,248,.5)';
      return '1px solid var(--border)';
    }

    function portLabel(p) {
      if (!p) return '';
      return String(p.port).padStart(2,'0');
    }

    function portTitle(p) {
      if (!p) return '';
      var lines = ['Port: '+p.ifName, 'Status: '+p.status];
      lines.push('Admin: ' + (p.adminStatus || 'up'));
      if (p.isUplink) { lines.push('Uplink port'); return lines.join('\n'); }
      if (p.poeStatus === 'delivering') {
        lines.push('PoE: delivering');
        if (p.poeDescr) lines.push('Device: '+p.poeDescr);
      }
      if (p.macs && p.macs.length) {
        p.macs.forEach(function(m){
          lines.push('MAC: '+m.mac);
          if (m.name) lines.push('Host: '+m.name);
          if (m.ip)   lines.push('IP: '+m.ip);
          lines.push('VLAN: '+m.vlan);
        });
      }
      return lines.join('\n');
    }

    function renderModule(ports) {
      var portMap = {};
      ports.forEach(function(p){ portMap[p.port] = p; });
      var maxPort = Math.max.apply(null, ports.map(function(p){ return p.port; }));
      if (maxPort % 2 !== 0) maxPort++;
      var pairs = [];
      for (var i = 1; i <= maxPort; i += 2) {
        pairs.push({ top: portMap[i] || null, bottom: portMap[i+1] || null });
      }
      return pairs.map(function(pair){
        var topP = pair.top;
        var botP = pair.bottom;
        var topDisabled = topP && ((topP.adminStatus || 'up') === 'down');
        var botDisabled = botP && ((botP.adminStatus || 'up') === 'down');
        var topHTML = topP
          ? '<div data-port="'+topP.ifName+'" style="'+
              'width:36px;height:28px;border-radius:3px 3px 0 0;'+
              'background:'+portColor(topP)+';'+
              'border:'+portBorder(topP)+';border-bottom:none;'+
              'display:flex;align-items:center;justify-content:center;'+
              'font-size:.6rem;font-family:var(--font-mono);color:var(--text-muted);'+
              'cursor:pointer;position:relative" title="'+esc(portTitle(topP))+'">'+
              portLabel(topP)+
              (topDisabled ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#f87171;font-weight:700;font-size:1rem;pointer-events:none;line-height:1">✕</div>' : '')+
              (topP.poeStatus==='delivering' ? '<div style="position:absolute;bottom:2px;right:2px;width:5px;height:5px;border-radius:50%;background:#22c55e"></div>' : '')+
            '</div>'
          : '<div style="width:36px;height:28px"></div>';
        var botHTML = botP
          ? '<div data-port="'+botP.ifName+'" style="'+
              'width:36px;height:28px;border-radius:0 0 3px 3px;'+
              'background:'+portColor(botP)+';'+
              'border:'+portBorder(botP)+';border-top:none;'+
              'display:flex;align-items:center;justify-content:center;'+
              'font-size:.6rem;font-family:var(--font-mono);color:var(--text-muted);'+
              'cursor:pointer;position:relative" title="'+esc(portTitle(botP))+'">'+
              portLabel(botP)+
              (botDisabled ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#f87171;font-weight:700;font-size:1rem;pointer-events:none;line-height:1">✕</div>' : '')+
              (botP.poeStatus==='delivering' ? '<div style="position:absolute;bottom:2px;right:2px;width:5px;height:5px;border-radius:50%;background:#22c55e"></div>' : '')+
            '</div>'
          : '<div style="width:36px;height:28px"></div>';
        return '<div style="display:flex;flex-direction:column;margin-right:3px">'+topHTML+botHTML+'</div>';
      }).join('');
    }

    var legend = '<div style="display:flex;gap:1rem;margin-top:1rem;font-size:.72rem;color:var(--text-muted);flex-wrap:wrap">'+
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(168,85,247,.2);border:1px solid rgba(168,85,247,.5);margin-right:4px"></span>Uplink</span>'+
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(56,189,248,.2);border:1px solid rgba(56,189,248,.5);margin-right:4px"></span>Up</span>'+
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(34,197,94,.25);border:1px solid rgba(34,197,94,.6);margin-right:4px"></span>Up + PoE</span>'+
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(255,255,255,.05);border:1px solid var(--border);margin-right:4px"></span>Down</span>'+
      '<span><span style="display:inline-flex;width:10px;height:10px;border-radius:2px;background:rgba(248,113,113,.16);border:1px solid rgba(248,113,113,.65);margin-right:4px;align-items:center;justify-content:center;color:#f87171;font-size:.55rem;line-height:1">✕</span>Admin Disabled</span>'+
      '<span><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#22c55e;margin-right:4px;vertical-align:middle"></span>PoE active</span>'+
    '</div>';

    // Build one card per module
    var html = modules.map(function(mod){
      var ports = allData.filter(function(p){ return p.module === mod; });
      return '<div class="card mb-3">'+
        '<div class="card-header" style="font-size:.8rem;font-weight:600;color:var(--text-muted)">Switch '+mod+'</div>'+
        '<div class="card-body" style="overflow-x:auto">'+
          '<div style="display:flex;flex-wrap:nowrap;align-items:flex-start;padding:.5rem 0;min-width:min-content">'+
            renderModule(ports)+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('') + '<div class="card"><div class="card-body">'+legend+'</div></div>';

    diag.innerHTML = html;

    // Wire up click handlers
    diag.querySelectorAll('[data-port]').forEach(function(el){
      el.addEventListener('click', function(){
        var ifName = el.dataset.port;
        var p = allData.find(function(x){ return x.ifName === ifName; });
        if (p) showPortModal(p);
      });
    });
  }

  function showPortModal(p) {
    var modal = $('swPortModal');
    var title = $('swPortModalTitle');
    var body  = $('swPortModalBody');
    if (!modal || !title || !body) return;

    title.textContent = p.ifName;

    if (p.isUplink) {
      body.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem">This is an uplink port connecting to the upstream router or switch.</div>';
      modal.style.display = 'flex';
      return;
    }

    var statusColor = p.status === 'up' ? '#22c55e' : '#6b7280';
    var poeColor    = p.poeStatus === 'delivering' ? '#22c55e' : 'var(--text-muted)';
    var swMeta = _swMeta[_selSwitch] || {};
    var canWritePortVlan = switchCanWrite && !!swMeta.writeEnabled;
    var canWritePortAdmin = switchCanWrite && !!swMeta.writeEnabled;
    var currentAccessVlan = p.accessVlan || ((p.macs && p.macs.length) ? p.macs[0].vlan : null);
    var vlanOptions = (swMeta.vlanOptions || []).slice().sort(function(a, b){ return a - b; });
    var isAdminUp = (p.adminStatus || 'up') === 'up';

    var devRows = '';
    if (p.macs && p.macs.length) {
      devRows = p.macs.map(function(m){
        return '<tr>'+
          '<td style="font-family:var(--font-mono);font-size:.75rem">'+esc(m.mac)+'</td>'+
          '<td style="font-size:.75rem">'+esc(m.name||'—')+'</td>'+
          '<td style="font-family:var(--font-mono);font-size:.75rem">'+esc(m.ip||'—')+'</td>'+
          '<td style="font-size:.75rem">'+esc(String(m.vlan))+'</td>'+
        '</tr>';
      }).join('');
    }

    body.innerHTML =
      '<table style="width:100%;font-size:.82rem;margin-bottom:1rem">'+
        '<tr><td style="color:var(--text-muted);width:40%">Status</td>'+
            '<td><span style="color:'+statusColor+';font-weight:600">'+p.status.toUpperCase()+'</span></td></tr>'+
        '<tr><td style="color:var(--text-muted)">Admin State</td>'+
            '<td>'+esc((p.adminStatus || 'up').toUpperCase())+'</td></tr>'+
        '<tr><td style="color:var(--text-muted)">Access VLAN</td>'+
            '<td>'+esc(currentAccessVlan || '—')+'</td></tr>'+
        '<tr><td style="color:var(--text-muted)">PoE</td>'+
            '<td><span style="color:'+poeColor+'">'+p.poeStatus+'</span></td></tr>'+
        (p.poeDescr ? '<tr><td style="color:var(--text-muted)">Device Type</td><td>'+esc(p.poeDescr)+'</td></tr>' : '')+
      '</table>'+
      (canWritePortAdmin
        ? '<div style="border-top:1px solid var(--border);padding-top:.8rem;margin-bottom:.9rem">'+
            '<div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.45rem">PORT ADMIN STATE</div>'+
            '<div style="display:flex;gap:.5rem;align-items:center">'+
              '<button id="swPortAdminBtn" class="btn btn-sm '+(isAdminUp ? 'btn-outline-danger' : 'btn-outline-success')+'">'+(isAdminUp ? 'Shutdown Port' : 'No Shutdown')+'</button>'+
              '<span id="swPortAdminMsg" style="font-size:.7rem;color:var(--text-muted)"></span>'+
            '</div>'+
          '</div>'
        : ''
      )+
      (canWritePortVlan
        ? '<div style="border-top:1px solid var(--border);padding-top:.8rem;margin-bottom:.9rem">'+
            '<div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.45rem">PORT VLAN MAPPING</div>'+
            (vlanOptions.length
              ? '<div style="display:flex;gap:.5rem;align-items:center">'+
                  '<select id="swPortVlanSelect" class="form-select form-select-sm" style="max-width:180px">'+
                    vlanOptions.map(function(v){
                      var selected = String(v) === String(currentAccessVlan) ? ' selected' : '';
                      return '<option value="'+v+'"'+selected+'>VLAN '+v+'</option>';
                    }).join('')+
                  '</select>'+
                  '<button id="swPortVlanSave" class="btn btn-sm btn-primary">Save</button>'+
                  '<span id="swPortVlanMsg" style="font-size:.7rem;color:var(--text-muted)"></span>'+
                '</div>'+
                '<div style="font-size:.64rem;color:var(--text-muted);margin-top:.4rem">Only VLANs present on both router and switch are listed, plus the configured default VLAN.</div>'
              : '<div style="font-size:.72rem;color:var(--text-muted)">No eligible VLANs found for this switch stack.</div>'
            )+
          '</div>'
        : ''
      )+
      (devRows
        ? '<div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.4rem">CONNECTED DEVICES</div>'+
          '<div style="overflow-x:auto"><table class="table table-vcenter mb-0" style="font-size:.78rem">'+
            '<thead><tr><th>MAC</th><th>Hostname</th><th>IP</th><th>VLAN</th></tr></thead>'+
            '<tbody>'+devRows+'</tbody>'+
          '</table></div>'
        : '<div style="color:var(--text-muted);font-size:.8rem;font-style:italic">No devices detected on this port</div>'
      );

    if (canWritePortVlan && vlanOptions.length) {
      var saveBtn = $('swPortVlanSave');
      var sel = $('swPortVlanSelect');
      var msg = $('swPortVlanMsg');
      if (saveBtn && sel) {
        saveBtn.addEventListener('click', function(){
          var vlan = parseInt(sel.value, 10);
          if (!vlan) return;
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving…';
          if (msg) msg.textContent = '';

          secureApiCall('/api/switches/'+encodeURIComponent(_selSwitch)+'/port-vlan', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ifName: p.ifName, vlan: vlan }),
          }).then(function(r){ return r.json(); }).then(function(data){
            if (!data || data.error) {
              if (msg) msg.textContent = (data && data.error) ? data.error : 'Failed';
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save';
              return;
            }
            if (msg) msg.textContent = 'Saved';
            loadSwitchPorts(_selSwitch);
            setTimeout(function(){
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save';
            }, 400);
          }).catch(function(){
            if (msg) msg.textContent = 'Failed';
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
          });
        });
      }
    }

    if (canWritePortAdmin) {
      var adminBtn = $('swPortAdminBtn');
      var adminMsg = $('swPortAdminMsg');
      if (adminBtn) {
        adminBtn.addEventListener('click', function(){
          var nextEnabled = !isAdminUp;
          adminBtn.disabled = true;
          if (adminMsg) adminMsg.textContent = '';
          secureApiCall('/api/switches/'+encodeURIComponent(_selSwitch)+'/port-admin', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ifName: p.ifName, enabled: nextEnabled }),
          }).then(function(r){ return r.json(); }).then(function(data){
            if (!data || data.error) {
              if (adminMsg) adminMsg.textContent = (data && data.error) ? data.error : 'Failed';
              adminBtn.disabled = false;
              return;
            }
            if (adminMsg) adminMsg.textContent = 'Saved';
            loadSwitchPorts(_selSwitch);
            setTimeout(function(){ adminBtn.disabled = false; }, 400);
          }).catch(function(){
            if (adminMsg) adminMsg.textContent = 'Failed';
            adminBtn.disabled = false;
          });
        });
      }
    }

    modal.style.display = 'flex';
  }

  // Modal close
  var closeBtn = $('swPortModalClose');
  if (closeBtn) closeBtn.addEventListener('click', function(){ $('swPortModal').style.display='none'; });
  document.addEventListener('click', function(e){
    if (e.target === $('swPortModal')) $('swPortModal').style.display='none';
  });

// Switch selector
  var swSel = $('swVisSelect');
  if (swSel) swSel.addEventListener('change', function(){
    _selSwitch = this.value;
    updateWriteMemoryButton();
    if (!_selSwitch) {
      var diag = $('swVisDiagram');
      if (diag) diag.innerHTML = '<div class="empty-state">Select a switch to view port layout</div>';
      return;
    }
    loadSwitchPorts(_selSwitch);
  });

// Auto-refresh visualiser every 120 seconds
  setInterval(function(){
    if (_selSwitch) loadSwitchPorts(_selSwitch);
  }, 120000);

  var writeMemBtn = $('swWriteMemoryBtn');
  if (writeMemBtn) writeMemBtn.addEventListener('click', function(){
    if (!_selSwitch) return;
    writeMemBtn.disabled = true;
    writeMemBtn.textContent = 'Writing…';
    secureApiCall('/api/switches/'+encodeURIComponent(_selSwitch)+'/write-memory', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(function(r){ return r.json(); }).then(function(data){
      if (!data || data.error) {
        writeMemBtn.textContent = 'Write Failed';
        setTimeout(updateWriteMemoryButton, 1400);
        return;
      }
      writeMemBtn.textContent = 'Written';
      setTimeout(updateWriteMemoryButton, 1200);
    }).catch(function(){
      writeMemBtn.textContent = 'Write Failed';
      setTimeout(updateWriteMemoryButton, 1400);
    });
  });

  // Load switch list on startup so visualiser is ready
  loadSwitchList();

  // Module selector
  var modSel = $('swVisModule');
  if (modSel) modSel.addEventListener('change', function(){
    _selModule = parseInt(this.value) || 1;
    if (_selSwitch) renderVisualiser(_selSwitch, _selModule);
  });

  // ── Router Backup ─────────────────────────────────────────────────────────
(function(){
  var btn    = $('backupBtn');
  var status = $('backupStatus');
  if (!btn) return;

  btn.addEventListener('click', function(){
    btn.disabled = true;
    btn.textContent = 'Generating…';
    if (status) status.textContent = 'Triggering backup on router…';

    fetch('/api/system/backup', { credentials: 'include' })
      .then(function(r){
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || r.statusText); });
        var disposition = r.headers.get('Content-Disposition') || '';
        var match = disposition.match(/filename="([^"]+)"/);
        var filename = match ? match[1] : 'ros-backup.backup';
        return r.blob().then(function(blob){ return { blob: blob, filename: filename }; });
      })
      .then(function(result){
        // Trigger browser download
        var url = URL.createObjectURL(result.blob);
        var a   = document.createElement('a');
        a.href     = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (status) status.textContent = 'Downloaded ' + result.filename;
        btn.disabled = false;
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download Backup';
      })
      .catch(function(e){
        if (status) status.textContent = 'Error: ' + e.message;
        btn.disabled = false;
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download Backup';
      });
  });
})();

})();

// ── WireGuard Management ──────────────────────────────────────────────────
(function(){
  var _wgPeers    = [];
  var _wgLists    = [];
  var _wanIps     = [];
  var _editPeer   = null;
  var _configName = '';
  var vpnCanWrite = false;

  // Set write permission when perms load
  var _origPermHandler = window._permHandler;
  document.addEventListener('permsLoaded', function(e){
    var perms = e.detail || {};
    vpnCanWrite = !!(perms.vpn && perms.vpn.write);
    var addBtn = $('wgAddPeerBtn');
    if (addBtn) addBtn.style.display = vpnCanWrite ? '' : 'none';
  });

  function loadWgData() {
    Promise.all([
      fetch('/api/wireguard/peers',        { credentials: 'include' }).then(r => r.json()),
      fetch('/api/wireguard/address-lists', { credentials: 'include' }).then(r => r.json()),
    ]).then(function(results){
      _wgPeers = results[0] || [];
      _wgLists = results[1] || [];
      // Re-render tiles with edit buttons
      renderWgTiles();
    }).catch(function(e){ console.error('[wg]', e); });
  }

  function renderWgTiles() {
    // Let the existing vpn:update handler render tiles first,
    // then overlay edit buttons on WireGuard interface tiles
    var grid = $('vpnPageGrid');
    if (!grid || !vpnCanWrite) return;
    // Add edit buttons to tiles that have matching peer data
    grid.querySelectorAll('.vpn-tile').forEach(function(tile){
      if (tile.querySelector('.wg-edit-btn')) return;
      var nameEl = tile.querySelector('.vpn-tile-name');
      if (!nameEl) return;
      var tileName = nameEl.textContent.trim();
      var peer = _wgPeers.find(function(p){ return p.name === tileName; });
      if (!peer) return;
      var btn = document.createElement('button');
      btn.className = 'wg-edit-btn';
      btn.dataset.id = peer.id;
      btn.textContent = 'Edit';
      btn.style.cssText = 'position:absolute;top:6px;right:6px;font-size:.6rem;padding:1px 6px;background:none;border:1px solid var(--border);border-radius:3px;color:var(--text-muted);cursor:pointer';
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        openEditModal(peer.id);
      });
      tile.style.position = 'relative';
      tile.appendChild(btn);
    });
  }

  function openEditModal(id) {
    var peer = _wgPeers.find(function(p){ return p.id === id; });
    if (!peer) return;
    _editPeer = peer;
    var title = $('wgEditTitle');
    var body  = $('wgEditBody');
    if (title) title.textContent = peer.name;

    var listOptions = _wgLists.map(function(l){
      return '<option value="'+esc(l)+'"'+(peer.currentList===l?' selected':'')+'>'+esc(l)+'</option>';
    }).join('');

    body.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:.85rem">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem;background:var(--bg-main);border-radius:6px">'+
          '<div>'+
            '<div style="font-size:.78rem;font-weight:600;color:var(--text-main)">'+esc(peer.name)+'</div>'+
            '<div style="font-size:.68rem;color:var(--text-muted);font-family:var(--font-mono)">'+esc(peer.allowedAddress)+'</div>'+
          '</div>'+
          '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">'+
            '<span style="font-size:.75rem;color:var(--text-muted)">Enabled</span>'+
            '<input type="checkbox" id="wgEditEnabled" '+(peer.disabled?'':'checked')+'>'+
          '</label>'+
        '</div>'+
        '<div>'+
          '<label style="font-size:.75rem;color:var(--text-muted);display:block;margin-bottom:.25rem">Address List</label>'+
          '<select id="wgEditList" class="form-control form-control-sm">'+
            '<option value="">— None —</option>'+
            listOptions+
          '</select>'+
        '</div>'+
        '<div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:.25rem">'+
          '<button id="wgEditCancelBtn" class="btn btn-sm btn-outline-secondary">Cancel</button>'+
          '<button id="wgEditSaveBtn" class="btn btn-sm btn-primary">Save</button>'+
        '</div>'+
      '</div>';

    // Wire up buttons
    $('wgEditCancelBtn').addEventListener('click', closeEditModal);
    $('wgEditSaveBtn').addEventListener('click', saveEditModal);

    var modal = $('wgEditModal');
    if (modal) modal.style.display = 'flex';
  }

  function closeEditModal() {
    var modal = $('wgEditModal');
    if (modal) modal.style.display = 'none';
    _editPeer = null;
  }

  function saveEditModal() {
    if (!_editPeer) return;
    var saveBtn  = $('wgEditSaveBtn');
    var enabled  = $('wgEditEnabled').checked;
    var list     = $('wgEditList').value;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    secureApiCall('/api/wireguard/peers/' + encodeURIComponent(_editPeer.id), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        disabled:       !enabled,
        addressList:    list,
        currentList:    _editPeer.currentList,
        allowedAddress: _editPeer.allowedAddress,
      })
    }).then(function(r){ return r.json(); }).then(function(data){
      if (data.ok) {
        closeEditModal();
        loadWgData();
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        alert('Error: ' + data.error);
      }
    }).catch(function(){
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    });
  }

  // ── Create modal ──────────────────────────────────────────────────────────
  function openCreateModal() {
    // Load WAN IPs for endpoint dropdown
    fetch('/api/wanips', { credentials: 'include' }).then(function(r){ return r.json(); })
      .then(function(data){
        _wanIps = (data.ips || []);
        var sel = $('wgcEndpoint');
        if (sel) sel.innerHTML = _wanIps.map(function(ip){
          return '<option value="'+esc(ip)+'">'+esc(ip)+'</option>';
        }).join('');
      });

    // Populate address list dropdown
    var listSel = $('wgcList');
    if (listSel) {
      listSel.innerHTML = '<option value="">— None —</option>' +
        _wgLists.map(function(l){
          return '<option value="'+esc(l)+'">'+esc(l)+'</option>';
        }).join('');
    }

    // Reset form
    var nameEl = $('wgcName'); if (nameEl) nameEl.value = '';
    var ipEl   = $('wgcIp');   if (ipEl)   ipEl.value   = '';
    var errEl  = $('wgcIpError'); if (errEl) errEl.style.display = 'none';
    document.querySelectorAll('input[name="wgcTunnel"]').forEach(function(r){ r.checked = r.value === 'full'; });
    var splitWrap = $('wgcSplitWrap'); if (splitWrap) splitWrap.style.display = 'none';
    var splitNets = $('wgcSplitNets'); if (splitNets) splitNets.value = '';

    // Show form, hide config
    var createBody = $('wgCreateBody'); if (createBody) createBody.style.display = '';
    var configDisp = $('wgConfigDisplay'); if (configDisp) configDisp.style.display = 'none';

    var modal = $('wgCreateModal');
    if (modal) modal.style.display = 'flex';
  }

  function closeCreateModal() {
    var modal = $('wgCreateModal');
    if (modal) modal.style.display = 'none';
  }

  // Tunnel mode toggle
  document.querySelectorAll('input[name="wgcTunnel"]').forEach(function(r){
    r.addEventListener('change', function(){
      var splitWrap = $('wgcSplitWrap');
      if (splitWrap) splitWrap.style.display = r.value === 'split' && r.checked ? '' : 'none';
    });
  });

  // Create save
  var createSaveBtn = $('wgCreateSaveBtn');
  if (createSaveBtn) createSaveBtn.addEventListener('click', function(){
    var name     = ($('wgcName') || {}).value || '';
    var ip       = ($('wgcIp') || {}).value || '';
    var list     = ($('wgcList') || {}).value || '';
    var endpoint = ($('wgcEndpoint') || {}).value || '';
    var tunnel   = (document.querySelector('input[name="wgcTunnel"]:checked') || {}).value || 'full';
    var splitNets = ($('wgcSplitNets') || {}).value || '';
    var errEl    = $('wgcIpError');

    // Validate
    if (!name || !ip || !endpoint) { alert('Name, IP and endpoint are required'); return; }
    var ipRe = /^192\.168\.168\.\d{1,3}$/;
    if (!ipRe.test(ip)) {
      if (errEl) { errEl.textContent = 'Must be in 192.168.168.0/24'; errEl.style.display = ''; }
      return;
    }
    if (errEl) errEl.style.display = 'none';

    var clientAllowedAddress = tunnel === 'full' ? '0.0.0.0/0' : splitNets.trim();
    if (tunnel === 'split' && !clientAllowedAddress) { alert('Enter split tunnel networks'); return; }

    createSaveBtn.disabled = true;
    createSaveBtn.textContent = 'Creating…';

    secureApiCall('/api/wireguard/peers', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, allowedAddress: ip + '/32', addressList: list, clientEndpoint: endpoint, clientAllowedAddress })
    }).then(function(r){ return r.json(); }).then(function(data){
      createSaveBtn.disabled = false;
      createSaveBtn.textContent = 'Create Peer';
      if (data.ok) {
        // Show config
        _configName = name;
        var configText = $('wgConfigText');
        if (configText) configText.value = data.config;
        var createBody = $('wgCreateBody'); if (createBody) createBody.style.display = 'none';
        var configDisp = $('wgConfigDisplay'); if (configDisp) configDisp.style.display = '';
        loadWgData();
      } else {
        alert('Error: ' + data.error);
      }
    }).catch(function(){
      createSaveBtn.disabled = false;
      createSaveBtn.textContent = 'Create Peer';
      alert('Request failed');
    });
  });

  // Config copy/download/done
  var configCopy = $('wgConfigCopy');
  if (configCopy) configCopy.addEventListener('click', function(){
    var t = $('wgConfigText');
    if (t) { navigator.clipboard.writeText(t.value); configCopy.textContent = 'Copied!'; setTimeout(function(){ configCopy.textContent = 'Copy'; }, 2000); }
  });

  var configDownload = $('wgConfigDownload');
  if (configDownload) configDownload.addEventListener('click', function(){
    var t = $('wgConfigText');
    if (!t) return;
    var blob = new Blob([t.value], { type: 'text/plain' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = (_configName || 'wireguard') + '.conf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  var configDone = $('wgConfigDone');
  if (configDone) configDone.addEventListener('click', closeCreateModal);

  // Modal close buttons
  var editClose = $('wgEditClose');
  if (editClose) editClose.addEventListener('click', closeEditModal);
  document.addEventListener('click', function(e){
    if (e.target === $('wgEditModal')) closeEditModal();
    if (e.target === $('wgCreateModal')) closeCreateModal();
  });

  var createClose = $('wgCreateClose');
  if (createClose) createClose.addEventListener('click', closeCreateModal);
  var createCancel = $('wgCreateCancelBtn');
  if (createCancel) createCancel.addEventListener('click', closeCreateModal);

  // Add peer button
  var addBtn = $('wgAddPeerBtn');
  if (addBtn) addBtn.addEventListener('click', openCreateModal);

  // Re-render edit buttons whenever VPN tiles update
  socket.on('vpn:update', function(){
    setTimeout(renderWgTiles, 100);
  });

  // Load WG data when VPN page is shown
  document.querySelectorAll('.nav-item[data-page="vpn"]').forEach(function(el){
    el.addEventListener('click', function(){
      if (vpnCanWrite) loadWgData();
    });
  });

  // Hook into perms — dispatch event from existing /api/me handler
  // We patch the existing handler to fire a custom event
  var _origMe = window._onMeLoaded;
  window._onMeLoaded = function(me){
    if (_origMe) _origMe(me);
    var perms = (me && me.permissions) || {};
    vpnCanWrite = !!(perms.vpn && perms.vpn.write);
    var addBtn = $('wgAddPeerBtn');
    if (addBtn) addBtn.style.display = vpnCanWrite ? '' : 'none';
    if (vpnCanWrite) loadWgData();
  };

})();