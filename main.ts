// ============================================================
// TIKTOK VIDEO DOWNLOADER API - PURE BACKEND (Deno Deploy)
// ============================================================
// Endpoint: https://your-app.deno.dev/?url=<tiktok-link>
// Returns: JSON with video URL, metadata, statistics
// Supports: tiktok.com, vm.tiktok.com, tiktoklite.com, vt.tiktoklite.com
// ============================================================

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const tiktokUrl = url.searchParams.get('url');
  const download = url.searchParams.has('download');

  // CORS headers for your separate frontend
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Replace with your frontend domain
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Validate URL parameter
  if (!tiktokUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing ?url parameter' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    );
  }

  try {
    // Normalize URL (follow short links)
    const normalized = await normalizeTikTokUrl(tiktokUrl);

    // Extract video ID
    const videoId = extractVideoId(normalized);
    if (!videoId) {
      throw new Error('Invalid TikTok URL - could not extract video ID');
    }

    // Fetch video data from TikTok
    const videoData = await fetchTikTokVideoData(videoId);

    // Generate signed download URL
    const directUrl = await generateDirectDownloadUrl(videoData);

    // Build response payload
    const responsePayload = {
      success: true,
      video_id: videoId,
      title: videoData.title || 'No title',
      username: videoData.author?.unique_id || videoData.author?.username || 'unknown',
      nickname: videoData.author?.nickname || '',
      duration: videoData.duration || 0,
      cover: videoData.cover || '',
      audio: videoData.music?.play_url || '',
      video_url: directUrl,
      download_url: directUrl + '&download=true',
      width: videoData.width || 1080,
      height: videoData.height || 1920,
      created_at: videoData.create_time || Date.now(),
      statistics: videoData.statistics || {
        play_count: 0,
        like_count: 0,
        comment_count: 0,
        share_count: 0,
      },
    };

    // If ?download=true, redirect to video
    if (download) {
      return Response.redirect(directUrl, 302);
    }

    return new Response(
      JSON.stringify(responsePayload, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to fetch video' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }
});

// ---------- HELPER FUNCTIONS ----------

/**
 * Normalize TikTok URLs from various formats
 */
async function normalizeTikTokUrl(rawUrl: string): Promise<string> {
  let cleanUrl = rawUrl.split('?')[0];

  // Follow short links
  if (cleanUrl.includes('vm.tiktok.com') || cleanUrl.includes('vt.tiktoklite.com')) {
    const response = await fetch(cleanUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    cleanUrl = response.url;
  }

  if (!cleanUrl.startsWith('https://')) {
    cleanUrl = cleanUrl.replace('http://', 'https://');
  }

  return cleanUrl;
}

/**
 * Extract numeric video ID from normalized URL
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /\/video\/(\d+)/i,
    /\/v\/(\d+)/i,
    /video_id=(\d+)/i,
    /\/photo\/(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  // Last attempt: extract any 19-digit number (TikTok IDs are 19 digits)
  const idMatch = url.match(/(\d{19})/);
  if (idMatch) return idMatch[1];

  return null;
}

/**
 * Fetch TikTok video data.
 * NOTE: This is a SIMULATED implementation for demo purposes.
 * For production, replace with actual TikTok API scraping:
 * - Fetch page HTML and extract JSON-LD
 * - Or use TikTok's internal API with signature generation (X-Bogus, X-Gorgon)
 * - Or use a third-party service like rapidapi.com
 */
async function fetchTikTokVideoData(videoId: string): Promise<any> {
  // For production implementation, you would do something like:
  /*
  const pageUrl = `https://www.tiktok.com/@user/video/${videoId}`;
  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  const html = await response.text();
  // Extract JSON-LD from <script type="application/ld+json">
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (jsonLdMatch) {
    const data = JSON.parse(jsonLdMatch[1]);
    // Parse video URL from data
  }
  */

  // Simulated realistic data for demo
  return {
    id: videoId,
    title: `Amazing TikTok Video #${videoId.slice(-4)}`,
    duration: 15,
    width: 1080,
    height: 1920,
    create_time: Math.floor(Date.now() / 1000) - 3600,
    cover: `https://p16-tiktokcdn.com/obj/tiktok-cover/${videoId}.jpg`,
    author: {
      unique_id: 'cooluser',
      nickname: 'Cool User 🎉',
      avatar: 'https://p16-tiktokcdn.com/obj/avatar.jpg',
    },
    music: {
      play_url: `https://cdn.tiktokmusic.com/audio/${videoId}.mp3`,
    },
    statistics: {
      play_count: 1245678,
      like_count: 45678,
      comment_count: 1234,
      share_count: 567,
    },
    // TikTok's pattern: replace _watermark with _nowm for no-watermark version
    video_no_watermark: `https://cdn.tiktokcdn.com/video/${videoId}_nowm.mp4`,
  };
}

/**
 * Generate signed download URL with expiry
 */
async function generateDirectDownloadUrl(videoData: any): Promise<string> {
  const baseUrl = videoData.video_no_watermark ||
    `https://cdn.tiktokcdn.com/video/${videoData.id}_nowm.mp4`;

  const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const secret = Deno.env.get('SIGNING_SECRET') || 'default-secret-change-me';
  const signature = await generateSignature(baseUrl, expiry, secret);

  return `${baseUrl}?expiry=${expiry}&sig=${signature}`;
}

/**
 * Generate HMAC-SHA256 signature using Deno's Web Crypto API
 */
async function generateSignature(url: string, expiry: number, secret: string): Promise<string> {
  const data = `${url}${expiry}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
        }
