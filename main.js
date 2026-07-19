// ============================================================
// HIGH-SPEED TIKTOK & FACEBOOK DOWNLOADER
// ============================================================
// - Direct CDN download (super fast)
// - Automatic proxy fallback when blocked
// - Smart caching for metadata
// - Parallel fetching for speed
// ============================================================

const cache = new Map();

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const tiktokUrl = url.searchParams.get('url');
  const download = url.searchParams.has('download');
  const forceProxy = url.searchParams.has('proxy') || false;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Range, Accept-Ranges',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // --- PROXY ENDPOINT (fallback) ---
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

  if (!tiktokUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing ?url parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  try {
    // Get video data
    const videoData = await getVideoData(tiktokUrl);

    if (!videoData || !videoData.video_url) {
      throw new Error('Could not extract video data');
    }

    // ---- SMART URL SELECTION ----
    // Option 1: Direct CDN (FASTEST)
    let directUrl = videoData.video_url;
    let useProxy = forceProxy;

    // Check if CDN is accessible (test with HEAD request)
    if (!useProxy) {
      try {
        const testResponse = await fetch(directUrl, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': videoData.platform === 'tiktok' ? 'https://www.tiktok.com/' : 'https://www.facebook.com/',
          },
        });
        
        if (testResponse.status === 403 || testResponse.status === 401) {
          useProxy = true;
          console.log('🔄 CDN blocked, using proxy fallback');
        }
      } catch {
        useProxy = true;
        console.log('🔄 CDN test failed, using proxy fallback');
      }
    }

    // Build final URL
    let finalVideoUrl;
    let finalDownloadUrl;
    let isProxied = false;

    if (useProxy) {
      finalVideoUrl = `${url.origin}/proxy?video=${encodeURIComponent(directUrl)}`;
      finalDownloadUrl = `${url.origin}/proxy?video=${encodeURIComponent(directUrl)}&download=true`;
      isProxied = true;
    } else {
      finalVideoUrl = directUrl;
      finalDownloadUrl = directUrl + '&download=true';
      isProxied = false;
    }

    const responsePayload = {
      success: true,
      video_id: videoData.id || 'unknown',
      title: videoData.title || 'Video',
      username: videoData.author || 'unknown',
      nickname: videoData.nickname || '',
      description: videoData.description || '',
      duration: videoData.duration || 0,
      cover: videoData.cover || '',
      audio: videoData.audio || '',
      // URLs
      video_url: finalVideoUrl,
      download_url: finalDownloadUrl,
      // Direct CDN (for advanced users)
      direct_url: directUrl,
      // Proxy URL (if needed)
      proxy_url: `${url.origin}/proxy?video=${encodeURIComponent(directUrl)}`,
      // Status
      is_proxied: isProxied,
      platform: videoData.platform || 'unknown',
      width: videoData.width || 1080,
      height: videoData.height || 1920,
      created_at: Math.floor(Date.now() / 1000),
      statistics: {
        play_count: videoData.plays || 0,
        like_count: videoData.likes || 0,
        comment_count: videoData.comments || 0,
        share_count: videoData.shares || 0,
      },
    };

    // Cache metadata
    const cacheKey = videoData.id || tiktokUrl;
    cache.set(cacheKey, {
      data: responsePayload,
      timestamp: Date.now(),
    });

    if (download) {
      return Response.redirect(finalDownloadUrl, 302);
    }

    return new Response(
      JSON.stringify(responsePayload, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
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
        details: error.stack || '',
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
// GET VIDEO DATA (TikTok & Facebook)
// ============================================================

async function getVideoData(inputUrl) {
  const platform = detectPlatform(inputUrl);
  console.log(`📥 Fetching ${platform} video:`, inputUrl);

  if (platform === 'tiktok') {
    return await getTikTokData(inputUrl);
  } else if (platform === 'facebook') {
    return await getFacebookData(inputUrl);
  } else {
    throw new Error('Unsupported platform. Only TikTok and Facebook are supported.');
  }
}

function detectPlatform(url) {
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook';
  return 'unknown';
}

// ============================================================
// TIKTOK DATA (Using TikWM API - Fast)
// ============================================================

async function getTikTokData(inputUrl) {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(inputUrl)}`;
  
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
  let videoUrl = video.play || video.hd_play || '';
  if (videoUrl) {
    videoUrl = videoUrl.replace(/_watermark/g, '_nowm');
  }

  return {
    platform: 'tiktok',
    id: video.id || 'unknown',
    title: video.title || 'TikTok Video',
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
    width: 1080,
    height: 1920,
  };
}

// ============================================================
// FACEBOOK DATA (Scraping)
// ============================================================

async function getFacebookData(inputUrl) {
  let cleanUrl = inputUrl.split('?')[0];
  
  if (cleanUrl.includes('m.facebook.com') || cleanUrl.includes('mbasic.facebook.com')) {
    cleanUrl = cleanUrl.replace('m.facebook.com', 'www.facebook.com');
    cleanUrl = cleanUrl.replace('mbasic.facebook.com', 'www.facebook.com');
  }

  const html = await fetchFacebookPage(cleanUrl);
  if (!html) {
    throw new Error('Failed to fetch Facebook page');
  }

  const data = extractFacebookData(html);
  if (!data) {
    throw new Error('Could not extract video data');
  }

  let videoUrl = data.videoUrl || '';
  if (!videoUrl) {
    videoUrl = extractVideoUrl(html);
  }

  if (!videoUrl) {
    throw new Error('Could not find video download URL');
  }

  videoUrl = videoUrl.replace(/&amp;/g, '&');

  return {
    platform: 'facebook',
    id: data.id || Date.now().toString(),
    title: data.title || 'Facebook Video',
    description: data.description || '',
    author: data.author || 'unknown',
    nickname: data.nickname || '',
    duration: data.duration || 0,
    cover: data.cover || '',
    audio: '',
    video_url: videoUrl,
    plays: data.plays || 0,
    likes: data.likes || 0,
    comments: data.comments || 0,
    shares: data.shares || 0,
    width: 1280,
    height: 720,
  };
}

async function fetchFacebookPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) return null;
    return await response.text();
  } catch (error) {
    console.log('❌ Facebook fetch error:', error.message);
    return null;
  }
}

function extractFacebookData(html) {
  try {
    // JSON-LD
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    if (jsonLdMatch) {
      try {
        const data = JSON.parse(jsonLdMatch[1]);
        if (data.video) {
          const video = data.video;
          return {
            id: video.identifier || '',
            title: video.name || '',
            description: video.description || '',
            author: video.author?.name || '',
            duration: parseInt(video.duration || 0),
            cover: video.thumbnailUrl || '',
            videoUrl: video.contentUrl || video.url || '',
            plays: parseInt(video.interactionCount || 0),
          };
        }
      } catch (e) {}
    }

    // Regex fallback
    return extractFacebookWithRegex(html);
  } catch (error) {
    return null;
  }
}

function extractFacebookWithRegex(html) {
  const result = {};

  // Title
  const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
  if (titleMatch) result.title = titleMatch[1];

  // Description
  const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
  if (descMatch) result.description = descMatch[1];

  // Author
  const authorMatch = html.match(/<meta property="og:site_name" content="([^"]+)"/);
  if (authorMatch) result.author = authorMatch[1];

  // Cover
  const coverMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (coverMatch) result.cover = coverMatch[1];

  // Video URL
  const videoMatch = html.match(/<meta property="og:video" content="([^"]+)"/);
  if (videoMatch) result.videoUrl = videoMatch[1];

  // Duration
  const durationMatch = html.match(/"duration":\s*"PT(\d+)M(\d+)S"/);
  if (durationMatch) {
    result.duration = parseInt(durationMatch[1]) * 60 + parseInt(durationMatch[2]);
  }

  // Stats
  const viewsMatch = html.match(/"views":\s*"([^"]+)"/);
  if (viewsMatch) result.plays = parseInt(viewsMatch[1].replace(/,/g, ''));

  const likesMatch = html.match(/"likes":\s*"([^"]+)"/);
  if (likesMatch) result.likes = parseInt(likesMatch[1].replace(/,/g, ''));

  return result;
}

function extractVideoUrl(html) {
  const patterns = [
    /"playable_url":"([^"]+)"/,
    /"browser_native_hd_url":"([^"]+)"/,
    /"browser_native_url":"([^"]+)"/,
    /<meta property="og:video" content="([^"]+)"/,
    /video src="([^"]+\.mp4)"/,
    /"video_url":"([^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let url = match[1].replace(/\\/g, '');
      url = url.replace(/&amp;/g, '&');
      return url;
    }
  }

  return '';
}

// ============================================================
// PROXY ENDPOINT (Fallback when CDN blocks)
// ============================================================

async function proxyVideo(videoUrl, originalRequest, corsHeaders) {
  const rangeHeader = originalRequest.headers.get('range');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': videoUrl.includes('tiktok') ? 'https://www.tiktok.com/' : 'https://www.facebook.com/',
    'Origin': videoUrl.includes('tiktok') ? 'https://www.tiktok.com' : 'https://www.facebook.com',
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

    if (contentRange) responseHeaders['Content-Range'] = contentRange;
    if (contentLength) responseHeaders['Content-Length'] = contentLength;

    const downloadParam = new URL(originalRequest.url).searchParams.get('download');
    if (downloadParam === 'true') {
      const ext = videoUrl.includes('tiktok') ? 'mp4' : 'mp4';
      responseHeaders['Content-Disposition'] = `attachment; filename="video_${Date.now()}.${ext}"`;
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
