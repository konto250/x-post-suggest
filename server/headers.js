export function securityHeaders(res,production=false) {
  const headers={
    'Cache-Control':'private, no-store, max-age=0, must-revalidate',
    'CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store',
    'Pragma':'no-cache','Expires':'0','Vary':'Cookie, Origin',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  };
  if(production) headers['Strict-Transport-Security']='max-age=31536000';
  for(const [key,value] of Object.entries(headers)) res.setHeader(key,value);
}
