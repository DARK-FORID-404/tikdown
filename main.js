// ============================================================
// SOCIAL DL - All-in-One Media Downloader API (JavaScript)
// Complete conversion from Python Flask to Deno/Node.js
// ============================================================

// ============================================================
// CONFIGURATION & CONSTANTS
// ============================================================

const DARKz_DEVELOPER = {
  api_name: "SOCIAL DL - All-in-One Media Downloader API",
  api_version: "1.0.0",
  api_developer: "DARK FORID",
  dev_github: "https://github.com/DARK-FORID-404",
  dev_telegram: "https://t.me/@UnknownXBoyX"
};

const DARKz_CLIENTS = {
  ios: {
    clientName: "IOS",
    clientVersion: "19.45.4",
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
    osName: "iPhone",
    osVersion: "18.1.0.22B83",
    userAgent: "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
    hl: "en",
    timeZone: "UTC",
    utcOffsetMinutes: 0
  },
  android_vr: {
    clientName: "ANDROID_VR",
    clientVersion: "1.60.19",
    androidSdkVersion: 32,
    deviceMake: "Oculus",
    deviceModel: "Quest 3",
    osName: "Android",
    osVersion: "12L",
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    hl: "en",
    timeZone: "UTC",
    utcOffsetMinutes: 0
  },
  android: {
    clientName: "ANDROID",
    clientVersion: "19.44.38",
    androidSdkVersion: 30,
    osName: "Android",
    osVersion: "11",
    userAgent: "com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip",
    hl: "en",
    timeZone: "UTC",
    utcOffsetMinutes: 0
  }
};

const DARKz_PLATFORMS = {
  youtube: /(youtube\.com|youtu\.be)/i,
  facebook: /(facebook\.com|fb\.watch)/i,
  instagram: /instagram\.com/i,
  tiktok: /tiktok\.com/i,
  twitter: /(twitter\.com|x\.com)/i,
  reddit: /reddit\.com/i,
  vimeo: /vimeo\.com/i,
  dailymotion: /dailymotion\.com/i,
  soundcloud: /soundcloud\.com/i,
  twitch: /twitch\.tv/i,
  pinterest: /pinterest\.com/i
};

// ============================================================
// PLATFORM DETECTION
// ============================================================

function DARKz_detect_platform(url) {
  for (const [platform, pattern] of Object.entries(DARKz_PLATFORMS)) {
    if (pattern.test(url)) {
      return platform;
    }
  }
  return "unknown";
}

// ============================================================
// YOUTUBE EXTRACTION (Pure JavaScript - No yt-dlp)
// ============================================================

function DARKz_extract_youtube_id(url) {
  const patterns = [
    /(?:v=|\/)([0-9A-Za-z_-]{11})(?:[&?]|$)/,
    /youtu\.be\/([0-9A-Za-z_-]{11})/,
    /embed\/([0-9A-Za-z_-]{11})/,
    /shorts\/([0-9A-Za-z_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function DARKz_fetch_youtube_page(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const headers = {
    "accept-language": "en-US,en;q=0.5",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
  };
  
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function DARKz_parse_youtube_video_info(html) {
  const result = {};
  
  // Extract ytInitialPlayerResponse
  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.*?});/s);
  if (!playerMatch) return null;
  
  let playerData;
  try {
    playerData = JSON.parse(playerMatch[1]);
  } catch {
    return null;
  }
  
  const videoDetails = playerData.videoDetails || {};
  const microformat = playerData.microformat?.playerMicroformatRenderer || {};
  
  if (!videoDetails.videoId) return null;
  
  result.id = videoDetails.videoId;
  result.title = videoDetails.title;
  result.description = (videoDetails.shortDescription || "").substring(0, 300);
  result.uploader = videoDetails.author;
  result.channel_id = videoDetails.channelId;
  result.channel_url = microformat.ownerProfileUrl;
  result.duration_seconds = parseInt(videoDetails.lengthSeconds || 0);
  result.view_count = parseInt(videoDetails.viewCount || 0);
  result.is_live = videoDetails.isLiveContent || false;
  result.upload_date = microformat.uploadDate;
  result.publish_date = microformat.publishDate;
  result.category = microformat.category;
  result.webpage_url = `https://www.youtube.com/watch?v=${videoDetails.videoId}`;
  
  // Extract thumbnails
  result.thumbnails = {};
  const thumbs = videoDetails.thumbnail?.thumbnails || [];
  for (const thumb of thumbs) {
    result.thumbnails[`${thumb.width}x${thumb.height}`] = thumb.url;
  }
  
  result.thumbnail = Object.values(result.thumbnails).pop() || 
                    `https://img.youtube.com/vi/${videoDetails.videoId}/maxresdefault.jpg`;
  
  return result;
}

function DARKz_parse_youtube_config(html) {
  const result = {};
  
  const keyMatch = html.match(/"INNERTUBE_API_KEY":"(.*?)"/);
  result.key = keyMatch ? keyMatch[1] : null;
  
  const clientMatch = html.match(/"INNERTUBE_CONTEXT_CLIENT_NAME":(\d+)/);
  result.client_name = clientMatch ? clientMatch[1] : null;
  
  const versionMatch = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"(.*?)"/);
  result.client_version = versionMatch ? versionMatch[1] : null;
  
  if (result.key && result.client_name) return result;
  return null;
}

async function DARKz_call_youtube_player(videoId, config, clientType = "ios") {
  const client = DARKz_CLIENTS[clientType] || DARKz_CLIENTS.ios;
  const url = `https://www.youtube.com/youtubei/v1/player?key=${config.key}`;
  
  const payload = {
    context: { client: client },
    videoId: videoId,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: "HTML5_PREF_WANTS"
      }
    },
    racyCheckOk: true
  };
  
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": client.userAgent,
    "X-YouTube-Client-Name": config.client_name,
    "X-YouTube-Client-Version": config.client_version
  };
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Fall through
  }
  return null;
}

function DARKz_extract_youtube_medias(playerData) {
  const audio = [];
  const video = [];
  const combined = [];
  
  const streamingData = playerData.streamingData || {};
  const formats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];
  
  for (const fmt of formats) {
    const entry = {
      itag: fmt.itag,
      bitrate: fmt.bitrate,
      quality: fmt.quality,
      filesize: parseInt(fmt.contentLength || 0),
      mimeType: fmt.mimeType || "",
      url: fmt.url
    };
    
    const mime = entry.mimeType;
    
    if (mime.includes("audio") && !mime.includes("video")) {
      audio.push(entry);
    } else if (mime.includes("video") && !mime.includes("audio")) {
      entry.height = fmt.height;
      entry.width = fmt.width;
      entry.fps = fmt.fps;
      video.push(entry);
    } else if (mime.includes("video")) {
      entry.height = fmt.height;
      entry.width = fmt.width;
      combined.push(entry);
    }
  }
  
  audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  video.sort((a, b) => (b.height || 0) - (a.height || 0));
  combined.sort((a, b) => (b.height || 0) - (a.height || 0));
  
  return {
    audio: audio.slice(0, 5),
    video: video.slice(0, 10),
    combined: combined.slice(0, 5)
  };
}

async function DARKz_youtube_extract(url) {
  const videoId = DARKz_extract_youtube_id(url);
  if (!videoId) return null;
  
  const html = await DARKz_fetch_youtube_page(videoId);
  if (!html) return null;
  
  const info = DARKz_parse_youtube_video_info(html);
  if (!info) return null;
  
  const config = DARKz_parse_youtube_config(html);
  if (!config) {
    info.medias = { audio: [], video: [], combined: [] };
    return info;
  }
  
  for (const clientType of ["ios", "android_vr", "android"]) {
    const player = await DARKz_call_youtube_player(videoId, config, clientType);
    if (player) {
      info.medias = DARKz_extract_youtube_medias(player);
      return info;
    }
  }
  
  info.medias = { audio: [], video: [], combined: [] };
  return info;
}

// ============================================================
// TIKTOK EXTRACTION (Pure JavaScript - No External APIs)
// ============================================================

async function DARKz_tiktok_extract(url) {
  // Resolve short URLs
  let cleanUrl = url;
  if (url.includes('vm.tiktok.com') || url.includes('vt.tiktoklite.com')) {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    cleanUrl = response.url;
  }
  
  // Extract video ID
  const idMatch = cleanUrl.match(/\/(video|v|photo)\/(\d+)/);
  if (!idMatch) return null;
  const videoId = idMatch[2];
  
  // Fetch page
  const response = await fetch(cleanUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"'
    }
  });
  
  if (!response.ok) return null;
  const html = await response.text();
  
  // Extract data from various sources
  let videoData = null;
  
  // Method 1: JSON-LD
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (jsonLdMatch) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      if (data.video) videoData = data;
    } catch {}
  }
  
  // Method 2: SIGI_STATE
  if (!videoData) {
    const sigiMatch = html.match(/<script>window\.SIGI_STATE\s*=\s*({.*?});<\/script>/s);
    if (sigiMatch) {
      try {
        const data = JSON.parse(sigiMatch[1]);
        videoData = data;
      } catch {}
    }
  }
  
  // Method 3: __NEXT_DATA__
  if (!videoData) {
    const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (nextMatch) {
      try {
        const data = JSON.parse(nextMatch[1]);
        videoData = data;
      } catch {}
    }
  }
  
  if (!videoData) return null;
  
  // Parse video data
  const result = {
    id: videoId,
    title: "No title",
    description: "",
    uploader: "Unknown",
    duration_seconds: 0,
    view_count: 0,
    like_count: 0,
    comment_count: 0,
    share_count: 0,
    thumbnail: "",
    webpage_url: cleanUrl,
    medias: { video: [], audio: [] }
  };
  
  // Extract from nested data
  let itemData = null;
  
  // Try to find itemInfo
  if (videoData.itemInfo?.itemStruct) {
    itemData = videoData.itemInfo.itemStruct;
  } else if (videoData.ItemModule) {
    const keys = Object.keys(videoData.ItemModule);
    if (keys.length > 0) {
      itemData = videoData.ItemModule[keys[0]];
    }
  }
  
  if (!itemData) return null;
  
  result.title = itemData.desc || itemData.title || "No title";
  result.description = (itemData.desc || "").substring(0, 300);
  result.uploader = itemData.author?.uniqueId || itemData.author?.username || "Unknown";
  result.duration_seconds = parseInt(itemData.duration || 0);
  result.view_count = parseInt(itemData.stats?.playCount || itemData.stats?.viewCount || 0);
  result.like_count = parseInt(itemData.stats?.diggCount || itemData.stats?.likeCount || 0);
  result.comment_count = parseInt(itemData.stats?.commentCount || 0);
  result.share_count = parseInt(itemData.stats?.shareCount || 0);
  result.thumbnail = itemData.cover || itemData.originCover || "";
  
  // Extract video URLs
  const videoUrls = [];
  if (itemData.video?.playAddr) {
    videoUrls.push({
      url: itemData.video.playAddr.replace(/_watermark/g, '_nowm'),
      quality: "normal",
      format: "mp4"
    });
  }
  if (itemData.video?.downloadAddr) {
    videoUrls.push({
      url: itemData.video.downloadAddr.replace(/_watermark/g, '_nowm'),
      quality: "download",
      format: "mp4"
    });
  }
  if (itemData.video?.bitrateInfo) {
    for (const bitrate of itemData.video.bitrateInfo) {
      if (bitrate.PlayAddr?.UrlList) {
        for (const url of bitrate.PlayAddr.UrlList) {
          videoUrls.push({
            url: url.replace(/_watermark/g, '_nowm'),
            quality: bitrate.Bitrate ? `${bitrate.Bitrate}kbps` : "unknown",
            format: "mp4"
          });
        }
      }
    }
  }
  
  result.medias.video = videoUrls.slice(0, 10);
  
  // Extract audio
  if (itemData.music?.playUrl) {
    result.medias.audio = [{
      url: itemData.music.playUrl,
      quality: "normal",
      format: "mp3"
    }];
  }
  
  return result;
}

// ============================================================
// GENERIC PLATFORM EXTRACTOR (Fallback using external API)
// ============================================================

async function DARKz_generic_extract(url, format, quality) {
  // For platforms without native JS extraction, use external APIs
  // This is a fallback that tries multiple approaches
  
  const platform = DARKz_detect_platform(url);
  
  // Try using TikWM for TikTok
  if (platform === "tiktok") {
    try {
      const response = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      if (data.code === 0 && data.data) {
        const video = data.data;
        return {
          success: true,
          platform: "tiktok",
          result: {
            title: video.title || "No title",
            description: (video.desc || "").substring(0, 500),
            uploader: video.author?.unique_id || "Unknown",
            duration_seconds: video.duration || 0,
            view_count: video.play_count || 0,
            like_count: video.digg_count || 0,
            comment_count: video.comment_count || 0,
            share_count: video.share_count || 0,
            thumbnail: video.cover || "",
            webpage_url: url,
            direct_url: video.play || video.hd_play || "",
            formats: [
              {
                format_id: "hd",
                ext: "mp4",
                resolution: "1080p",
                filesize: video.size || 0,
                url: video.hd_play || video.play || ""
              },
              {
                format_id: "sd",
                ext: "mp4",
                resolution: "720p",
                filesize: 0,
                url: video.play || ""
              },
              {
                format_id: "audio",
                ext: "mp3",
                resolution: "audio",
                filesize: 0,
                url: video.music?.play_url || ""
              }
            ]
          }
        };
      }
    } catch {}
  }
  
  // Try using YouTube's oembed for YouTube
  if (platform === "youtube") {
    try {
      const videoId = DARKz_extract_youtube_id(url);
      if (videoId) {
        const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        const data = await response.json();
        if (data.title) {
          return {
            success: true,
            platform: "youtube",
            result: {
              title: data.title,
              description: "",
              uploader: data.author_name || "Unknown",
              duration_seconds: 0,
              view_count: 0,
              like_count: 0,
              comment_count: 0,
              share_count: 0,
              thumbnail: data.thumbnail_url || "",
              webpage_url: url,
              direct_url: `https://www.youtube.com/embed/${videoId}`,
              formats: [
                {
                  format_id: "embed",
                  ext: "html",
                  resolution: "embed",
                  filesize: 0,
                  url: `https://www.youtube.com/embed/${videoId}`
                }
              ]
            }
          };
        }
      }
    } catch {}
  }
  
  return null;
}

// ============================================================
// MAIN API HANDLER (Deno/Node.js compatible)
// ============================================================

async function DARKz_handle_request(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  
  // Home route
  if (path === '/' || path === '/api/info') {
    return new Response(JSON.stringify({
      success: true,
      message: path === '/' ? "DARKz [SOCIAL DL] API is Running" : "API Info Fetched Successfully",
      usage: "https://your-api.deno.dev/api/download?url=VIDEO_URL&format=video&quality=best",
      developer: DARKz_DEVELOPER
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
  
  // Download endpoint
  if (path === '/api/download') {
    const params = url.searchParams;
    const videoUrl = params.get('url');
    const format = params.get('format') || 'video';
    const quality = params.get('quality') || 'best';
    
    if (!videoUrl) {
      return new Response(JSON.stringify({
        success: false,
        error: "Missing required param: ?url=",
        developer: DARKz_DEVELOPER
      }, null, 2), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    try {
      const platform = DARKz_detect_platform(videoUrl);
      let result = null;
      
      // Platform-specific extraction
      if (platform === "youtube") {
        const data = await DARKz_youtube_extract(videoUrl);
        if (data) {
          result = {
            success: true,
            platform: "youtube",
            developer: DARKz_DEVELOPER,
            result: data
          };
        }
      } else if (platform === "tiktok") {
        const data = await DARKz_tiktok_extract(videoUrl);
        if (data) {
          result = {
            success: true,
            platform: "tiktok",
            developer: DARKz_DEVELOPER,
            result: data
          };
        }
      }
      
      // Fallback to generic extractor
      if (!result) {
        const fallback = await DARKz_generic_extract(videoUrl, format, quality);
        if (fallback) {
          result = fallback;
          result.developer = DARKz_DEVELOPER;
        }
      }
      
      if (result) {
        return new Response(JSON.stringify(result, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      return new Response(JSON.stringify({
        success: false,
        error: `Failed to extract video from ${platform}. Video may be private, deleted, or region-blocked.`,
        developer: DARKz_DEVELOPER
      }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
      
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
        developer: DARKz_DEVELOPER
      }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json',
