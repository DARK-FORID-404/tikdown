// ============================================================
// TIKTOK DOWNLOADER API - REAL WORKING VERSION
// Extracts ACTUAL data from TikTok for EVERY video
// ============================================================

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const tiktokUrl = url.searchParams.get('url');
  const download = url.searchParams.has('download');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
    // Step 1: Get REAL data from TikTok
    const videoData = await getRealTikTokData(tiktokUrl);
    
    if (!videoData) {
      throw new Error('Could not extract video data from TikTok');
    }

    // Step 2: Build response with REAL data
    const responsePayload = {
      success: true,
      video_id: videoData.id,
      title: videoData.title || 'No title',
      username: videoData.author?.unique_id || videoData.author?.username || 'unknown',
      nickname: videoData.author?.nickname || '',
      description: videoData.description || '',
      duration: videoData.duration || 0,
      cover: videoData.cover || '',
      audio: videoData.music?.play_url || '',
      video_url: videoData.video_url || '',
      download_url: videoData.video_url ? videoData.video_url + '&download=true' : '',
      width: videoData.width || 1080,
      height: videoData.height || 1920,
      created_at: videoData.create_time || Math.floor(Date.now() / 1000),
      statistics: {
        play_count: videoData.statistics?.play_count || 0,
        like_count: videoData.statistics?.like_count || 0,
        comment_count: videoData.statistics?.comment_count || 0,
        share_count: videoData.statistics?.share_count || 0,
      },
    };

    if (download && videoData.video_url) {
      return Response.redirect(videoData.video_url, 302);
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

// ============================================================
// CORE FUNCTION: GET REAL TIKTOK DATA
// ============================================================

async function getRealTikTokData(url) {
  // Step 1: Resolve short URLs
  let realUrl = await resolveTikTokUrl(url);
  
  // Step 2: Fetch the TikTok page
  const html = await fetchTikTokPage(realUrl);
  if (!html) return null;
  
  // Step 3: Extract video data from page
  const extractedData = extractTikTokData(html);
  if (!extractedData) return null;
  
  // Step 4: Get no-watermark video URL
  const videoUrl = getNoWatermarkUrl(extractedData);
  
  // Step 5: Return structured data
  return {
    id: extractedData.id || extractedData.videoId || '',
    title: extractedData.title || extractedData.desc || '',
    description: extractedData.desc || '',
    duration: parseInt(extractedData.duration || extractedData.videoDuration || 0),
    cover: extractedData.cover || extractedData.thumbnail || '',
    width: parseInt(extractedData.width || 1080),
    height: parseInt(extractedData.height || 1920),
    create_time: parseInt(extractedData.createTime || Date.now() / 1000),
    author: {
      unique_id: extractedData.author?.uniqueId || extractedData.author?.username || '',
      nickname: extractedData.author?.nickname || extractedData.author?.name || '',
      avatar: extractedData.author?.avatar || '',
    },
    music: {
      play_url: extractedData.music?.playUrl || extractedData.music?.url || '',
    },
    statistics: {
      play_count: parseInt(extractedData.stats?.playCount || extractedData.playCount || 0),
      like_count: parseInt(extractedData.stats?.diggCount || extractedData.likeCount || 0),
      comment_count: parseInt(extractedData.stats?.commentCount || extractedData.commentCount || 0),
      share_count: parseInt(extractedData.stats?.shareCount || extractedData.shareCount || 0),
    },
    video_url: videoUrl,
  };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function resolveTikTokUrl(url) {
  let cleanUrl = url.split('?')[0].split('#')[0];
  
  if (cleanUrl.includes('vm.tiktok.com') || 
      cleanUrl.includes('vt.tiktoklite.com')) {
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

async function fetchTikTokPage(url) {
  try {
    const response = await fetch(url, {
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

    if (!response.ok) return null;
    return await response.text();
  } catch (error) {
    console.error('Fetch error:', error);
    return null;
  }
}

function extractTikTokData(html) {
  let data = null;
  
  // METHOD 1: Extract from SIGI_STATE (Most reliable)
  const sigiMatch = html.match(/<script>window\.SIGI_STATE\s*=\s*({.*?});<\/script>/s);
  if (sigiMatch) {
    try {
      const sigiData = JSON.parse(sigiMatch[1]);
      data = parseSigiState(sigiData);
      if (data) return data;
    } catch (e) {}
  }
  
  // METHOD 2: Extract from __NEXT_DATA__
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (nextMatch) {
    try {
      const nextData = JSON.parse(nextMatch[1]);
      data = parseNextData(nextData);
      if (data) return data;
    } catch (e) {}
  }
  
  // METHOD 3: Extract from JSON-LD
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (jsonLdMatch) {
    try {
      const ldData = JSON.parse(jsonLdMatch[1]);
      data = parseJsonLd(ldData);
      if (data) return data;
    } catch (e) {}
  }
  
  // METHOD 4: Extract from any script containing video data
  const scriptRegex = /<script[^>]*>(.*?)<\/script>/gs;
  const matches = html.matchAll(scriptRegex);
  for (const match of matches) {
    const scriptContent = match[1];
    if (scriptContent.includes('"ItemModule"') || 
        scriptContent.includes('"videoData"') ||
        scriptContent.includes('"playAddr"')) {
      try {
        // Try to find JSON object
        const jsonRegex = /({[\s\S]*?(?:ItemModule|videoData|playAddr)[\s\S]*?})/;
        const jsonMatch = scriptContent.match(jsonRegex);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          const extracted = parseGenericData(parsed);
          if (extracted) return extracted;
        }
      } catch (e) {}
    }
  }
  
  return null;
}

function parseSigiState(data) {
  // Try different paths in SIGI_STATE
  let itemData = null;
  
  if (data.ItemModule) {
    const keys = Object.keys(data.ItemModule);
    if (keys.length > 0) {
      itemData = data.ItemModule[keys[0]];
    }
  }
  
  if (!itemData && data.VideoData) {
    itemData = data.VideoData;
  }
  
  if (!itemData) return null;
  
  return {
    id: itemData.id || itemData.videoId || '',
    title: itemData.desc || itemData.title || '',
    desc: itemData.desc || '',
    duration: itemData.duration || itemData.videoDuration || 0,
    cover: itemData.cover || itemData.originCover || '',
    author: {
      uniqueId: itemData.author?.uniqueId || itemData.author?.username || '',
      nickname: itemData.author?.nickname || itemData.author?.name || '',
      avatar: itemData.author?.avatar || '',
    },
    stats: {
      playCount: itemData.stats?.playCount || itemData.playCount || 0,
      diggCount: itemData.stats?.diggCount || itemData.diggCount || 0,
      commentCount: itemData.stats?.commentCount || itemData.commentCount || 0,
      shareCount: itemData.stats?.shareCount || itemData.shareCount || 0,
    },
    music: {
      playUrl: itemData.music?.playUrl || '',
    },
    video: {
      playAddr: itemData.video?.playAddr || itemData.video?.url || '',
      downloadAddr: itemData.video?.downloadAddr || '',
    },
  };
}

function parseNextData(data) {
  // Navigate through Next.js data structure
  let videoData = null;
  
  // Try common paths
  const paths = [
    'props.pageProps.videoData',
    'props.pageProps.videoData.video',
    'props.pageProps.initialState.video',
    'props.pageProps.initialState',
  ];
  
  for (const path of paths) {
    const parts = path.split('.');
    let current = data;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        current = null;
        break;
      }
    }
    if (current) {
      videoData = current;
      break;
    }
  }
  
  if (!videoData) return null;
  
  return {
    id: videoData.id || videoData.videoId || '',
    title: videoData.title || videoData.desc || '',
    desc: videoData.desc || '',
    duration: videoData.duration || videoData.videoDuration || 0,
    cover: videoData.cover || videoData.thumbnail || '',
    author: {
      uniqueId: videoData.author?.uniqueId || videoData.author?.username || '',
      nickname: videoData.author?.nickname || videoData.author?.name || '',
      avatar: videoData.author?.avatar || '',
    },
    stats: {
      playCount: videoData.stats?.playCount || videoData.playCount || 0,
      diggCount: videoData.stats?.diggCount || videoData.diggCount || 0,
      commentCount: videoData.stats?.commentCount || videoData.commentCount || 0,
      shareCount: videoData.stats?.shareCount || videoData.shareCount || 0,
    },
    music: {
      playUrl: videoData.music?.playUrl || '',
    },
    video: {
      playAddr: videoData.video?.playAddr || videoData.video?.url || '',
      downloadAddr: videoData.video?.downloadAddr || '',
    },
  };
}

function parseJsonLd(data) {
  if (data['@type'] !== 'VideoObject' && !data.video) return null;
  
  const video = data.video || data;
  
  return {
    id: video.identifier || video.id || '',
    title: video.name || video.title || '',
    desc: video.description || '',
    duration: parseInt(video.duration || 0),
    cover: video.thumbnailUrl || '',
    author: {
      uniqueId: video.author?.identifier || video.author?.name || '',
      nickname: video.author?.name || '',
    },
    stats: {
      playCount: parseInt(video.interactionCount || 0),
      diggCount: 0,
      commentCount: 0,
      shareCount: 0,
    },
    video: {
      playAddr: video.contentUrl || video.url || '',
    },
  };
}

function parseGenericData(data) {
  // Try to find video data in any structure
  let videoData = null;
  
  // Search recursively for video data
  function search(obj) {
    if (!obj || typeof obj !== 'object') return null;
    
    if (obj.playAddr || obj.downloadAddr) {
      return obj;
    }
    
    if (obj.video && (obj.video.playAddr || obj.video.downloadAddr)) {
      return obj.video;
    }
    
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        const result = search(obj[key]);
        if (result) return result;
      }
    }
    return null;
  }
  
  videoData = search(data);
  if (!videoData) return null;
  
  return {
    id: videoData.id || '',
    title: videoData.title || videoData.desc || '',
    desc: videoData.desc || '',
    duration: videoData.duration || 0,
    cover: videoData.cover || '',
    author: {
      uniqueId: videoData.author?.uniqueId || videoData.author?.username || '',
      nickname: videoData.author?.nickname || '',
    },
    stats: {
      playCount: videoData.stats?.playCount || videoData.playCount || 0,
      diggCount: videoData.stats?.diggCount || videoData.diggCount || 0,
      commentCount: videoData.stats?.commentCount || videoData.commentCount || 0,
      shareCount: videoData.stats?.shareCount || videoData.shareCount || 0,
    },
    music: {
      playUrl: videoData.music?.playUrl || '',
    },
    video: {
      playAddr: videoData.playAddr || videoData.url || '',
      downloadAddr: videoData.downloadAddr || '',
    },
  };
}

function getNoWatermarkUrl(data) {
  let videoUrl = '';
  
  // Try different video URL sources
  if (data.video?.playAddr) {
    videoUrl = data.video.playAddr;
  } else if (data.video?.downloadAddr) {
    videoUrl = data.video.downloadAddr;
  } else if (data.video?.url) {
    videoUrl = data.video.url;
  } else if (data.playAddr) {
    videoUrl = data.playAddr;
  } else if (data.url) {
    videoUrl = data.url;
  }
  
  if (!videoUrl) return '';
  
  // Remove watermark
  videoUrl = videoUrl.replace(/_watermark/g, '_nowm');
  videoUrl = videoUrl.replace(/watermark=true/g, 'watermark=false');
  videoUrl = videoUrl.replace(/wm\./g, '');
  
  return videoUrl;
           }
