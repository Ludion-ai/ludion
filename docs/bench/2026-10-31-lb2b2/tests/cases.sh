# LB2b2 harness cases (see run.sh for the layout). Each line: name, DIR, main scan exit and answer, head scan exit and answer.
apk add -q bash jq tar >/dev/null 2>&1
T=/t/test; : > /tmp/empty
c() { echo "$1"; DIR=$2 MAINRC=$3 MAINOUT=$4 HEADRC=$5 HEADOUT=$6 bash /t/test/h/run.sh; }
c "1 main php, head fixed -> false"           php 1 $T/php.json 0 $T/php-fixed.json
c "2 head exit 1 empty output -> true (N1)"   php 1 $T/php.json 1 /tmp/empty
c "3 head exit 0 empty output -> true (N1)"   php 1 $T/php.json 0 /tmp/empty
c "4 head still vulnerable -> true"           php 1 $T/php.json 1 $T/php.json
c "5 main exit 0 real answer -> false"        php 0 $T/npm-fixed.json 0 /tmp/empty
c "6 main exit 0 php answer -> false"         php 0 $T/php-fixed.json 0 /tmp/empty
c "7 main exit 0 empty -> true"               php 0 /tmp/empty 0 /tmp/empty
c "8 dir ./php/ normalised -> false"          ./php/ 1 $T/php.json 0 $T/php-fixed.json
c "9 dir a/../php -> true (N2)"               a/../php 1 $T/php.json 0 $T/php-fixed.json
c "10 dir . with change -> true"              . 1 $T/php.json 0 $T/php-fixed.json
c2() { echo "$1"; MOVED=$2 DIR=php MAINRC=1 MAINOUT=$T/php.json HEADRC=0 HEADOUT=$T/php-fixed.json bash /t/test/h/run.sh; }
c2 "11 renamed out of php/ (N3) -> true" "1\nelsewhere/x\nphp/ludion.security.json\n"
c2 "12 php-a changed only -> false" "1\nphp-a/Dockerfile\n"
