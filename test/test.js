const s = new require( "../index.js" ).sdp
const projectrtp = require( "../index.js" ).ProjectRTP

let test1 = `v=0
o=Z 1608235282228 1 IN IP4 192.168.0.141
s=Z
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 8 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`


if ( "pcma" != s.create( test1 ).intersection( "pcma pcmu" ) ) {
  throw "Intersection should return pcma"
}

let test2 = `v=0
o=Z 1608236465345 1 IN IP4 192.168.0.141
s=Z
c=IN IP4 192.168.0.141
t=0 0
m=audio 56802 RTP/AVP 8 0 9 97 106 101 98
a=rtpmap:97 iLBC/8000
a=fmtp:97 mode=20
a=rtpmap:106 opus/48000/2
a=fmtp:106 minptime=20; cbr=1; maxaveragebitrate=40000; useinbandfec=1
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=sendrecv`

if ( "pcma pcmu" != s.create( test2 ).intersection( "pcma pcmu" ) ) {
  throw "Intersection should return pcma pcmu"
}

if ( "pcma" != s.create( test2 ).intersection( "pcma pcmu", true ) ) {
  throw "Intersection should return pcma"
}

if ( "pcmu" != s.create( test2 ).intersection( "pcmu pcma", true ) ) {
  throw "Intersection should return pcmu"
}

if ( "ilbc pcmu" != s.create( test2 ).intersection( "ilbc pcmu" ) ) {
  throw "Intersection should return ilbc pcmu"
}

if ( "ilbc pcmu" != s.create( test2 ).intersection( [ 97, 0 ] ) ) {
  throw "Intersection should return ilbc pcmu"
}

/* Setsession id only to permorm the test - normally use the default changing one */
let newsdp = s.create().setsessionid( 0 ).addcodecs( "pcma" ).toString()
if ( "v=0\r\n" +
  "o=- 0 0 IN IP4 127.0.0.1\r\n" +
  "s=project\r\n" +
  "c=IN IP4 127.0.0.1\r\n" +
  "t=0 0\r\n" +
  "m=audio 0 RTP/AVP 8\r\n" +
  "a=rtpmap:8 PCMA/8000\r\n" +
  "a=ptime:20\r\n" +
  "a=sendrecv\r\n" != newsdp ) {
  console.log( newsdp )
  throw "SDP not correctly created (pcma)"
}

newsdp = s.create().setsessionid( 0 ).addcodecs( "ilbc pcma" ).toString()
if ( "v=0\r\n" +
  "o=- 0 0 IN IP4 127.0.0.1\r\n" +
  "s=project\r\n" +
  "c=IN IP4 127.0.0.1\r\n" +
  "t=0 0\r\n" +
  "m=audio 0 RTP/AVP 97 8\r\n" +
  "a=rtpmap:97 ilbc/8000\r\n" +
  "a=rtpmap:8 PCMA/8000\r\n" +
  "a=fmtp:97 mode=20\r\n" +
  "a=ptime:20\r\n" +
  "a=sendrecv\r\n" != newsdp ) {

  console.log( newsdp )
  throw "SDP not correctly created (ilbc pcma)"
}

/* don't allow duplicates */
newsdp = s.create().setsessionid( 0 ).addcodecs( "ilbc ilbc pcma" ).toString()
if ( "v=0\r\n" +
  "o=- 0 0 IN IP4 127.0.0.1\r\n" +
  "s=project\r\n" +
  "c=IN IP4 127.0.0.1\r\n" +
  "t=0 0\r\n" +
  "m=audio 0 RTP/AVP 97 8\r\n" +
  "a=rtpmap:97 ilbc/8000\r\n" +
  "a=rtpmap:8 PCMA/8000\r\n" +
  "a=fmtp:97 mode=20\r\n" +
  "a=ptime:20\r\n" +
  "a=sendrecv\r\n" != newsdp ) {

  console.log( newsdp )
  throw "SDP not correctly created (ilbc pcma)"
}

/* We are offered ilbc - but a ptime of 30, so we need to exclude it */
let test3 = `v=0
o=Z 1608292844058 1 IN IP4 192.168.0.141
s=Z
c=IN IP4 192.168.0.141
t=0 0
m=audio 56802 RTP/AVP 8 0 9 106 101 98 97
a=rtpmap:106 opus/48000/2
a=fmtp:106 minptime=20; cbr=1; maxaveragebitrate=40000; useinbandfec=1
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=rtpmap:97 iLBC/8000
a=fmtp:97 mode=30
a=sendrecv`

if ( "pcmu" !== s.create( test3 ).intersection( "ilbc pcmu" ) ) {
  throw "Only pcmu should be included as mode=30 for ilbc which is wrong"
}

let test4 = `v=0
o=Z 1608303841226 1 IN IP4 192.168.0.141
s=Z
c=IN IP4 192.168.0.141
t=0 0
m=audio 56802 RTP/AVP 8 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`

if ( "pcma" !== s.create( test4 ).intersection( "pcmu pcma" ) ) {
  throw "We should have found pcma"
}

let test5 = `v=0
o=Z 1610744131900 1 IN IP4 127.0.0.1
s=Z
c=IN IP4 127.0.0.1
t=0 0
m=audio 56858 RTP/AVP 106 9 98 101 0 8 18 3
a=rtpmap:106 opus/48000/2
a=fmtp:106 maxplaybackrate=16000; sprop-maxcapturerate=16000; minptime=20; cbr=1; maxaveragebitrate=20000; useinbandfec=1
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:18 G729/8000
a=fmtp:18 annexb=no
a=sendrecv`

let remote = s.create( test5 )
let chosen = remote.intersection( "g722 pcmu", true )

if ( "g722" !== chosen ) {
  throw "We should have found 722 but got " + chosen
}

remote.setaudiodirection( "inactive" )
newsdp = remote.toString()

if( "v=0\r\n" +
    "o=Z 1610744131900 1 IN IP4 127.0.0.1\r\n" +
    "s=Z\r\n" +
    "c=IN IP4 127.0.0.1\r\n" +
    "t=0 0\r\n" +
    "m=audio 56858 RTP/AVP 106 9 98 101 0 8 18 3\r\n" +
    "a=rtpmap:106 opus/48000/2\r\n" +
    "a=rtpmap:98 telephone-event/48000\r\n" +
    "a=rtpmap:101 telephone-event/8000\r\n" +
    "a=rtpmap:18 G729/8000\r\n" +
    "a=fmtp:106 maxplaybackrate=16000; sprop-maxcapturerate=16000; minptime=20; cbr=1; maxaveragebitrate=20000; useinbandfec=1\r\n" +
    "a=fmtp:98 0-16\r\n" +
    "a=fmtp:101 0-16\r\n" +
    "a=fmtp:18 annexb=no\r\n" +
    "a=inactive\r\n" != newsdp ) {
  throw "SDP whilst making it inactive looks different " + newsdp
}


/* The next tests require the projectrtp server to be running (or multiple) */
const rtp = new projectrtp()

console.log( "This next test opens multiple channels, one at once then 100 at once and should clean up ok" )
console.log( "Waiting for new projectrtp connection - please start the server" )
rtp.on( "connection", async ( conn ) => {


  console.log( "Opening 100 one at a time" )
  for ( let i = 0; i < 100; i++ ) {

    let channela = await rtp.channel( s.create( test4 ).select( "g722" ) )
    channela.rfc2833( 101 )
    channela.echo()

    let channelb = await rtp.channel( s.create( test4 ).select( "g722" ) )
    channelb.rfc2833( 101 )
    channelb.echo()

    await channelb.destroy()
    await channela.destroy()
  }

  console.log( "opening 100 using Promise.all" )
  let channelcollection = []
  for ( let i = 0; i < 100; i++ ) {
    channelcollection.push( rtp.channel( s.create( test4 ).select( "g722" ) ) )
  }

  let openedchannels = await Promise.all( channelcollection )

  console.log( "closing 100" )
  let closechannelcollection = []
  openedchannels.forEach( ( chan ) => {
    closechannelcollection.push( chan.destroy() )
  } )

  await Promise.all( closechannelcollection )

  console.log( "Opening one to ensure it times out and closes" )
  let channela = await rtp.channel( s.create( test4 ).select( "g722" ) )
  let closed = false
  let channelconn = channela.conn

  channela.on( "close", ( m ) => {
    closed = true
  } )
  await new Promise( resolve => setTimeout( resolve, 10000 ) )

  if ( !closed ) {
    throw "The channel did not close through inactivity"
  }


  if ( 0 !== channelconn.stats.active ) {
    throw `Uh oh, we still have ${channelconn.status.channels.active} channels open - please run these tests after restarting projectrtp with no other connections`
  }

  console.log( "Finished" )
  rtp.close()

} )
