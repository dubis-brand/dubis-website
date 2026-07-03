#!/usr/bin/env bash
# Ep1 "הלייק" — compose: 3 dialogue clips + product macro + HE subs (PNG overlays).
# Sub timings (T1..) are set after silencedetect on each clip. Run from ep1 dir.
set -e

C1=clip1.mp4; C2=clip2.mp4; C3=clip3.mp4

# normalize every clip to 1080x1920 25fps + aac 48k stereo
for c in "$C1" "$C2" "$C3"; do
  ffmpeg -y -i "$c" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=25" \
    -c:v libx264 -preset fast -crf 19 -c:a aac -ar 48000 -ac 2 "norm-$c" </dev/null
done
ffmpeg -y -i macro.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest \
  -c:v libx264 -preset fast -crf 19 -c:a aac -ar 48000 -ac 2 norm-macro.mp4 </dev/null

# concat
printf "file 'norm-clip1.mp4'\nfile 'norm-clip2.mp4'\nfile 'norm-clip3.mp4'\nfile 'norm-macro.mp4'\n" > list.txt
ffmpeg -y -f concat -safe 0 -i list.txt -c copy joined.mp4 </dev/null

# subtitle overlays — timings passed as env or edited below after silencedetect
: "${S1:=1.0,4.5}"; : "${S2:=5.5,9.0}"; : "${S3:=9.5,12.0}"; : "${S4:=12.5,15.0}"; : "${S5:=16.0,20.0}"; : "${S6:=21.0,24.0}"; : "${SP_START:=0}"
IFS=, read a1 b1 <<< "$S1"; IFS=, read a2 b2 <<< "$S2"; IFS=, read a3 b3 <<< "$S3"
IFS=, read a4 b4 <<< "$S4"; IFS=, read a5 b5 <<< "$S5"; IFS=, read a6 b6 <<< "$S6"

ffmpeg -y -i joined.mp4 \
  -i sub-s1.png -i sub-s2.png -i sub-s3.png -i sub-s4.png -i sub-s5.png -i sub-s6.png -i sub-sP.png \
  -filter_complex "\
[0:v][1:v]overlay=0:1560:enable='between(t,$a1,$b1)'[v1];\
[v1][2:v]overlay=0:1560:enable='between(t,$a2,$b2)'[v2];\
[v2][3:v]overlay=0:1560:enable='between(t,$a3,$b3)'[v3];\
[v3][4:v]overlay=0:1560:enable='between(t,$a4,$b4)'[v4];\
[v4][5:v]overlay=0:1560:enable='between(t,$a5,$b5)'[v5];\
[v5][6:v]overlay=0:1560:enable='between(t,$a6,$b6)'[v6];\
[v6][7:v]overlay=0:1560:enable='gte(t,$SP_START)'[v]" \
  -map "[v]" -map 0:a -c:v libx264 -preset fast -crf 19 -c:a copy ep1-final.mp4 </dev/null

echo DONE; ffmpeg -i ep1-final.mp4 2>&1 | grep -E "Duration|Stream"
