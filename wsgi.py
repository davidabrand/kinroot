"""How a web host (like PythonAnywhere) starts Kinroot. On your own computer, use run.bat instead.

The host runs this file and serves `application` over https. Your database, secret key and
photos live in the instance/ folder next to it, which is created on first start and never
uploaded to GitHub.
"""
from werkzeug.middleware.proxy_fix import ProxyFix

from kinroot import create_app

# Online, logins only travel over https.
application = create_app({"SESSION_COOKIE_SECURE": True})
# The host sits in front of the app, so trust its note of each visitor's real address
# (the log-in limiter counts failed tries per visitor).
application.wsgi_app = ProxyFix(application.wsgi_app, x_for=1, x_proto=1)
app = application
