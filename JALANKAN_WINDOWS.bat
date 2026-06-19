@echo off
cd /d %~dp0
echo Menginstall dependency Flask...
python -m pip install -r requirements.txt
echo.
echo Folder final: UAS_Clientserver_MBG_Rendiaigobrandon_23343082
echo Menjalankan MBG - Memo Belajar Digital...
echo Buka browser: http://127.0.0.1:5000
echo Login demo: admin / mbg12345
echo.
python app.py
pause
