// ============================================================
// TIKTOK DOWNLOADER - FULLY WORKING WITH VIDEO PROXY
// ============================================================

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const tiktokUrl = url.searchParams.get('url');
  const download = url.searchParams.has('download');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Range, Accept-Ranges',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // --- PROXY ENDPOINT: /proxy?video=URL ---
  if (url.pathname === '/proxy') {
    const videoUrl = url.searchParams.get('video');
    if (!videoUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing video parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
    return await proxyVideo(videoUrl, request, corsHeaders);
  }

  // --- MAIN API ENDPOINT ---
  if (!tiktokUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing ?url parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  try {
    // Get video data using TikWM API (reliable, no scraping issues)
    const videoData = await getVideoData(tiktokUrl);

    if (!videoData) {
      throw new Error('Could not extract video data');
    }

    // Generate proxy URL
    const proxyUrl = `${url.origin}/proxy?video=${encodeURIComponent(videoData.video_url)}`;

    const responsePayload = {
      success: true,
      video_id: videoData.id,
      title: videoData.title || 'No title',
      username: videoData.author || 'unknown',
      nickname: videoData.nickname || '',
      description: videoData.description || '',
      duration: videoData.duration || 0,
      cover: videoData.cover || '',
      audio: videoData.audio || '',
      video_url: proxyUrl, // ← PROXY URL (no access denied)
      download_url: proxyUrl + '&download=true',
      width: 1080,
      height: 1920,
      created_at: Math.floor(Date.now() / 1000),
      statistics: {
        play_count: videoData.plays || 0,
        like_count: videoData.likes || 0,
        comment_count: videoData.comments || 0,
        share_count: videoData.shares || 0,
      },
    };

    if (download && videoData.video_url) {
      const downloadProxyUrl = `${url.origin}/proxy?video=${encodeURIComponent(videoData.video_url)}&download=true`;
      return Response.redirect(downloadProxyUrl, 302);
    }

    return new Response(
      JSON.stringify(responsePayload, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error('❌ Error:', error.message);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to fetch video',
      }),
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

// ============================================================
// VIDEO PROXY FUNCTION (BYPASSES "ACCESS DENIED")
// ============================================================

async function proxyVideo(videoUrl, originalRequest, corsHeaders) {
  const rangeHeader = originalRequest.headers.get('range');

  // Headers that mimic a real browser
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.tiktok.com/',
    'Origin': 'https://www.tiktok.com',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
  };

  if (rangeHeader) {
    headers['Range'] = rangeHeader;
  }

  try {
    const videoResponse = await fetch(videoUrl, { headers });

    if (!videoResponse.ok) {
      throw new Error(`CDN returned ${videoResponse.status}`);
    }

    const contentType = videoResponse.headers.get('content-type') || 'video/mp4';
    const contentLength = videoResponse.headers.get('content-length');
    const contentRange = videoResponse.headers.get('content-range');
    const status = videoResponse.status === 206 ? 206 : 200;

    const responseHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      ...corsHeaders,
    };

    if (contentRange) {
      responseHeaders['Content-Range'] = contentRange;
    }
    if (contentLength) {
      responseHeaders['Content-Length'] = contentLength;
    }

    const downloadParam = new URL(originalRequest.url).searchParams.get('download');
    if (downloadParam === 'true') {
      responseHeaders['Content-Disposition'] = `attachment; filename="tiktok_video_${Date.now()}.mp4"`;
    }

    return new Response(videoResponse.body, {
      status: status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error.message);
    throw new Error(`Failed to proxy video: ${error.message}`);
  }
}

// ============================================================
// GET VIDEO DATA (USING TIKWM API - RELIABLE)
// ============================================================

async function getVideoData(inputUrl) {
  // Use TikWM API (free, reliable, no scraping needed)
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(inputUrl)}`;
  console.log('📥 Fetching from TikWM:', apiUrl);

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`TikWM API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.code !== 0 || !data.data) {
    throw new Error('Video not found on TikTok');
  }

  const video = data.data;

  // Get no-watermark video URL
  let videoUrl = video.play || video.hd_play || '';
  if (videoUrl) {
    videoUrl = videoUrl.replace(/_watermark/g, '_nowm');
  }

  return {
    id: video.id || 'unknown',
    title: video.title || 'No title',
    description: video.desc || '',
    author: video.author?.unique_id || 'unknown',
    nickname: video.author?.nickname || '',
    duration: video.duration || 0,
    cover: video.cover || '',
    audio: video.music?.play_url || '',
    video_url: videoUrl,
    plays: video.play_count || 0,
    likes: video.digg_count || 0,
    comments: video.comment_count || 0,
    shares: video.share_count || 0,
  };
    }
