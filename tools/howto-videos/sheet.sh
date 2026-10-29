#!/bin/bash
# contact sheet of a clip: one frame every N seconds
n=$1; step=${2:-1.5}; f=${OUT:-out}/$n.mp4
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $f); cnt=$(python3 -c "import math;print(min(24,math.ceil($d/$step)))")
w=$(ffprobe -v error -select_streams v -show_entries stream=width -of csv=p=0 $f)
if [ "$w" -lt 1000 ]; then sc=200; cols=8; else sc=420; cols=4; fi
ffmpeg -loglevel error -y -i $f -vf "fps=1/$step,scale=$sc:-1,drawtext=text='%{pts\:hms}':x=4:y=4:fontsize=14:fontcolor=red,tile=${cols}x$(( (cnt+cols-1)/cols ))" -frames:v 1 sheet-$n.png && echo "sheet-$n.png ${d}s"
