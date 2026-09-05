const EXAMPLE_JSON = `{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "segments": [
    {
      "startTime": "0:45",
      "endTime": "1:30",
      "title": "Hook mở đầu"
    },
    {
      "startTime": "5:20",
      "endTime": "6:10",
      "title": "Insight hay nhất"
    }
  ],
  "resolution": "480",
  "fastMode": true
}`;

function buildPromptTemplate(videoUrl) {
  const url = videoUrl?.trim() || 'YOUR_YOUTUBE_URL';

  return `Bạn là chuyên gia phân tích video YouTube. Hãy xem/phân tích video sau và chọn các khoảnh khắc hay nhất để cắt clip ngắn.

Link video: ${url}

Nhiệm vụ:
- Chọn 3–8 phân đoạn hay nhất trong video
- Tiêu chí: hook mạnh, cao trào, insight sâu, quote ấn tượng, đoạn hài/hồi hộp

Yêu cầu output:
- CHỈ trả về JSON thuần, KHÔNG markdown, KHÔNG giải thích thêm
- Mỗi phân đoạn dài 30–90 giây
- Thời gian không chồng lấn, nằm trong độ dài video
- startTime/endTime: định dạng m:ss hoặc h:mm:ss (vd: "1:30", "2:00:25") — KHÔNG viết "200:25", phải là "2:00:25"
- title: mô tả ngắn lý do chọn đoạn đó

Cấu trúc JSON bắt buộc:
{
  "url": "${url}",
  "segments": [
    {
      "startTime": "m:ss",
      "endTime": "m:ss",
      "title": "Mô tả ngắn"
    }
  ],
  "resolution": "480",
  "fastMode": true
}

resolution: best | 1080 | 720 | 480 | 360
fastMode: true (tải nhanh) hoặc false (chất lượng cao hơn)

Ví dụ output:
${EXAMPLE_JSON}`;
}
