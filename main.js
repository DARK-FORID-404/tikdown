// ============================================================
// TIKTOK VIDEO DOWNLOADER - WITH PROXY (NO ACCESS DENIED)
// ============================================================

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const tiktokUrl = url.searchParams.get('url');
  const download = url.searchParams.has('download');
  const proxy = url.searchParams.has('proxy') || true; // Default to proxy

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!tiktokUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing ?url parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  try {
    const normalizedUrl = await resolveTikTokUrl(tiktokUrl);
    const { videoId, username } = extractVideoInfo(normalizedUrl);
    
    if (!videoId) {
      throw new Error('Could not extract video ID from URL');
    }

    // Get REAL video data from TikTok
    const videoData = await scrapeTikTokVideo(normalizedUrl, videoId, username);
    
    // Extract the REAL CDN URL from TikTok's data
    const realVideoUrl = videoData.video_no_watermark || videoData.video_url;
    
    if (!realVideoUrl) {
      throw new Error('Could not extract video URL from TikTok');
    }

    // If download parameter is set, proxy the video
    if (download || proxy) {
      return await proxyVideo(realVideoUrl, request, corsHeaders);
    }

    // Otherwise return metadata with proxy URL
    const responsePayload = {
      success: true,
      video_id: videoId,
      title: videoData.title || 'No title',
      username: videoData.author?.unique_id || 'unknown',
      nickname: videoData.author?.nickname || '',
      description: videoData.description || '',
      duration: videoData.duration || 0,
      cover: videoData.cover || '',
      audio: videoData.audio || '',
      // Use proxy URL instead of direct CDN URL
      video_url: `${url.origin}${url.pathname}?url=${encodeURIComponent(tiktokUrl)}&proxy=true`,
      download_url: `${url.origin}${url.pathname}?url=${encodeURIComponent(tiktokUrl)}&download=true&proxy=true`,
      width: videoData.width || 1080,
      height: videoData.height || 1920,
      created_at: videoData.create_time || Math.floor(Date.now() / 1000),
      statistics: videoData.statistics || {},
    };

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
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Failed to fetch video',
        details: error.stack 
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

/**
 * Proxy the video through your API to avoid CDN blocking
 */
async function proxyVideo(videoUrl, originalRequest, corsHeaders) {
  // Get range headers for partial content (video seeking)
  const rangeHeader = originalRequest.headers.get('range');
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.tiktok.com/',
    'Origin': 'https://www.tiktok.com',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
  };

  // Add range header if present
  if (rangeHeader) {
    headers['Range'] = rangeHeader;
  }

  try {
    // Fetch the video from TikTok's CDN with proper headers
    const videoResponse = await fetch(videoUrl, {
      headers: headers,
    });

    if (!videoResponse.ok) {
      throw new Error(`CDN returned ${videoResponse.status}: ${videoResponse.statusText}`);
    }

    // Get the content length and type
    const contentType = videoResponse.headers.get('content-type') || 'video/mp4';
    const contentLength = videoResponse.headers.get('content-length');
    const contentRange = videoResponse.headers.get('content-range');

    // Create response with video stream
    const responseHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': `attachment; filename="tiktok_video_${Date.now()}.mp4"`,
      ...corsHeaders,
    };

    // Add content-range for partial content
    if (contentRange) {
      responseHeaders['Content-Range'] = contentRange;
    }

    // Set content length if available
    if (contentLength) {
      responseHeaders['Content-Length'] = contentLength;
    }

    // Set proper status for partial content
    const status = videoResponse.status === 206 ? 206 : 200;

    return new Response(videoResponse.body, {
      status: status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('Proxy error:', error);
    throw new Error(`Failed to proxy video: ${error.message}`);
  }
}

// ============================================================
// HELPER FUNCTIONS (from previous code - keep these)
// ============================================================

async function resolveTikTokUrl(rawUrl) {
  let cleanUrl = rawUrl.split('?')[0].split('#')[0];
  
  if (cleanUrl.includes('vm.tiktok.com') || 
      cleanUrl.includes('vt.tiktoklite.com') ||
      cleanUrl.includes('tiktok.com/@') === false) {
    
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

function extractVideoInfo(url) {
  const match = url.match(/@([^\/]+)\/video\/(\d+)/);
  if (match) {
    return { username: match[1], videoId: match[2] };
  }

  const fallbackMatch = url.match(/\/video\/(\d+)/);
  if (fallbackMatch) {
    return { username: 'unknown', videoId: fallbackMatch[1] };
  }

  const idMatch = url.match(/(\d{19})/);
  if (idMatch) {
    return { username: 'unknown', videoId: idMatch[1] };
  }

  return { username: null, videoId: null };
}

async function scrapeTikTokVideo(pageUrl, videoId, username) {
  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch TikTok page: ${response.status}`);
  }

  const html = await response.text();

  // Extract video data from various sources
  let videoData = extractJsonLd(html) || 
                  extractNextData(html) || 
                  extractSigiState(html) || 
                  extractFromScripts(html);

  if (!videoData) {
    throw new Error('Could not extract video data from page');
  }

  return normalizeVideoData(videoData, videoId, username);
}

function extractJsonLd(html) {
  const jsonLdRegex = /<script type="application\/ld\+json">(.*?)<\/script>/s;
  const match = html.match(jsonLdRegex);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}

function extractNextData(html) {
  const regex = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;
  const match = html.match(regex);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    return findVideoInObject(data);
  } catch (e) {
    return null;
  }
}

function extractSigiState(html) {
  const regex = /<script>window\.SIGI_STATE\s*=\s*({.*?});<\/script>/s;
  const match = html.match(regex);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    return findVideoInObject(data);
  } catch (e) {
    return null;
  }
}

function extractFromScripts(html) {
  const scriptRegex = /<script[^>]*>(.*?)<\/script>/gs;
  const matches = html.matchAll(scriptRegex);
  for (const match of matches) {
    const scriptContent = match[1];
    if (scriptContent.includes('"video"') || 
        scriptContent.includes('"play_addr"') ||
        scriptContent.includes('"downloadAddr"')) {
      try {
        const jsonRegex = /{[\s\S]*?"video"[\s\S]*?}/;
        const jsonMatch = scriptContent.match(jsonRegex);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        continue;
      }
    }
  }
  return null;
}

function findVideoInObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  
  if (obj.video && obj.video.playAddr) return obj.video;
  if (obj.playAddr && obj.id) return obj;
  if (obj.videoInfo && obj.videoInfo.video) return obj.videoInfo.video;
  if (obj.itemInfo && obj.itemInfo.video) return obj.itemInfo.video;
  
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object') {
      const result = findVideoInObject(obj[key]);
      if (result) return result;
    }
  }
  return null;
}

function normalizeVideoData(rawData, videoId, username) {
  const video = rawData.video || rawData;
  
  let videoUrl = null;
  if (video.playAddr) videoUrl = video.playAddr;
  else if (video.downloadAddr) videoUrl = video.downloadAddr;
  else if (video.contentUrl) videoUrl = video.contentUrl;
  else if (video.url) videoUrl = video.url;
  else if (video.play) videoUrl = video.play;
  else if (video.hd_play) videoUrl = video.hd_play;
  
  // Remove watermark
  if (videoUrl) {
    videoUrl = videoUrl.replace(/_watermark/g, '_nowm');
    videoUrl = videoUrl.replace(/watermark=true/g, 'watermark=false');
  }
  
  const author = rawData.author || rawData.owner || video.author || {};
  const stats = rawData.stats || rawData.statistics || video.stats || {};
  const music = rawData.music || video.music || {};
  
  return {
    id: video.id || videoId,
    title: rawData.title || rawData.desc || video.desc || video.title || 'No title',
    description: rawData.desc || video.desc || '',
    duration: parseInt(video.duration || rawData.duration || 0),
    cover: video.cover || video.origin_cover || video.thumbnailUrl || '',
    width: parseInt(video.width || 1080),
    height: parseInt(video.height || 1920),
    create_time: parseInt(video.createTime || rawData.createTime || Math.floor(Date.now() / 1000)),
    author: {
      unique_id: author.uniqueId || author.username || author.name || username || 'unknown',
      nickname: author.nickname || author.name || author.uniqueId || 'Unknown',
      avatar: author.avatar || author.avatarThumb || '',
      id: author.id || '',
    },
    audio: music.playUrl || music.url || music.playUrl || '',
    statistics: {
      play_count: parseInt(stats.playCount || stats.plays || stats.viewCount || 0),
      like_count: parseInt(stats.diggCount || stats.likes || stats.favoriteCount || 0),
      comment_count: parseInt(stats.commentCount || stats.comments || 0),
      share_count: parseInt(stats.shareCount || stats.shares || 0),
      download_count: parseInt(stats.downloadCount || stats.downloads || 0),
    },
    video_no_watermark: videoUrl || '',
  };
                                     }
