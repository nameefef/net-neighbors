// Workers + KV 实时后端
// 提供：心跳注册、在线邻居列表、留言板

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 获取客户端真实 IP
      const clientIP = request.headers.get('CF-Connecting-IP') ||
                       request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
                       '0.0.0.0';
      const parts = clientIP.split('.');
      const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;

      // === GET /api/neighbors ===
      if (path === '/api/neighbors' && request.method === 'GET') {
        const subnetPrefix = subnet.replace('.0/24', '');
        const now = Date.now();
        const onlineUsers = [];
        let cursor = undefined;
        do {
          const list = await env.KV.list({ prefix: `online:${subnetPrefix}.`, cursor });
          for (const key of list.keys) {
            const val = await env.KV.get(key);
            if (val) {
              try {
                const u = JSON.parse(val);
                if (now - u.ts < 60000) { // 60s 内心跳有效
                  onlineUsers.push(u);
                } else {
                  // 过期了删掉
                  ctx.waitUntil(env.KV.delete(key));
                }
              } catch(e) {}
            }
          }
          cursor = list.cursor;
        } while (cursor);

        return new Response(JSON.stringify({
          subnet,
          onlineCount: onlineUsers.length,
          users: onlineUsers,
          yourIp: clientIP,
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // === POST /api/heartbeat ===
      if (path === '/api/heartbeat' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const name = (body.name || '匿名邻居').slice(0, 20);
        const key = `online:${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}`;
        const userData = {
          ip: clientIP,
          name: name,
          ts: Date.now(),
        };
        await env.KV.put(key, JSON.stringify(userData), { expirationTtl: 120 });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // === GET /api/msgs ===
      if (path === '/api/msgs' && request.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const subnetPrefix = subnet.replace('.0/24', '');
        const msgList = [];
        let cursor = undefined;
        do {
          const list = await env.KV.list({ prefix: `msg:${subnetPrefix}.`, cursor });
          for (const key of list.keys) {
            const val = await env.KV.get(key);
            if (val) {
              try { msgList.push(JSON.parse(val)); } catch(e) {}
            }
          }
          cursor = list.cursor;
        } while (cursor);

        msgList.sort((a, b) => b.ts - a.ts);
        return new Response(JSON.stringify({
          subnet,
          messages: msgList.slice(0, limit),
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // === POST /api/msgs ===
      if (path === '/api/msgs' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const text = (body.text || '').trim().slice(0, 500);
        if (!text) {
          return new Response(JSON.stringify({ error: '消息不能为空' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const bodyName = (body.name || '匿名邻居').slice(0, 20);
        const subnetPrefix = subnet.replace('.0/24', '');
        const msgId = crypto.randomUUID();
        const msgKey = `msg:${subnetPrefix}.${parts[3]}:${msgId}`;
        const msg = {
          id: msgId,
          name: bodyName,
          ip: clientIP,
          text,
          ts: Date.now(),
          time: new Date().toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
          }),
        };
        await env.KV.put(msgKey, JSON.stringify(msg), { expirationTtl: 86400 * 7 });
        return new Response(JSON.stringify({ ok: true, msg }), {
          status: 201,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // 404
      return new Response(JSON.stringify({ error: 'Not Found', paths: ['/api/neighbors', '/api/heartbeat', '/api/msgs'] }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }
};
