import React from "react";
import { useImmer } from "use-immer";


function Progress({value, total, withOf=false}) {
  const withProgress = !(value === undefined || value === total)
  return (
    <>
      {withOf && (<>{Math.floor(value)} of {total}</>)}
      {withProgress && (<>{"    "}
        <progress max={total} value={value} />{"  "}
        {Math.floor(100*value/total)} %
      </>)}
    </>
  )
}

function Time({seconds}) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds - mins*60)
  return (mins > 0) ? (<>{mins}m{secs}s</>) : (<>{secs}s</>)
}

function WebKnotty() {

  const url = 'ws://localhost:9000'

  const [state, setState] = useImmer({
    ws: null,
    connected: false,
    status: 'Disconnected',

    running: false,
    lines: [],
    progress: {},
    tasks: {},
    pidmap: {},
    maxtasks: 0,
    setscene_started: false,
    tasks_started: false,
    shutdown: 0,
  })

  function connect() {
    if (state.ws) {
      state.ws.close()
      setState((draft) => {
        draft.connected = false
        draft.status = 'Disconnecting'
      })
      return
    }

    setState((draft) => {draft.status = "Connecting"})
    console.log("WS: OPEN " + url)
    const ws = new WebSocket(url)

    ws.onopen = () => {
      console.log("WS: CONNECTED")
      setState((draft) => {
        draft.ws = ws
        draft.status = 'Connected'
        draft.connected = true
        draft.running = false
      })
      ws.send(JSON.stringify({command: 'replay'}))
    }

    ws.onclose = (event) => {
      console.log("WS: DISCONNECTED " + event.code)
      setState((draft) => {
        draft.status = (event.code === 1000) ? "Disconnected" : "Connection failed"
        draft.connected = false
        draft.ws = null
      })
    }

    ws.onmessage = (evt) => {
      // console.log("WS: >>  " + evt.data)
      const json = JSON.parse(evt.data);
      if ('event' in json) {
          onEvent(json)
          return
      } 
      console.log(json)
    }
  }

  const titles = {
    "CacheLoad": "Loading cache",
    "Parse": "Parsing recipes",
  }

  function onEvent(data) {
    // console.log(event)
    const name = data.event
    const event = data.data
    switch(name) {

      case 'Replay':
        event.forEach((e) => {
          if (e.event !== 'Replay') onEvent(e)
        })
        break

      case 'ConfigParsed':
      case 'runQueueTaskFailed':
        break

      case 'Reset':
        setState((draft) => {
          draft.running = true
          draft.lines = []
          draft.progress = {}
          draft.tasks = {}
          draft.pidmap = {}
          draft.maxtasks = 0
          draft.setscene_started = false
          draft.tasks_started = false
          draft.shutdown = 0
        })
        break

      case 'Shutdown':
        setState((draft) => {
          draft.shutdown = data.value
        })
        break

      case 'Quit':
      case 'CommandCompleted':
      case 'CommandFailed':
        setState((draft) => {
          draft.running = false
        })
        break

      case 'Log':
      case 'Print':
        if (!data.msg) {
          console.log(data)
        }
        if (data.msg && !(data.msg.startsWith('NOTE: Running') || data.msg.startsWith('NOTE: recipe'))) {
          setState((draft) => {
            draft.lines.push({msg: data.msg})
          })
        }
        break

      case 'CacheLoadStarted':
      case 'ParseStarted':
        setState((draft) => {
          const title = name.replace("Started", "")
          draft.progress[title] = {
            'title': titles[title] || title,
            'total': event.total,
            'current': 0,
          }
          draft.lines.push({progress: title})
        })
        break

      case 'CacheLoadProgress':
      case 'ParseProgress':
        setState((draft) => {
          const title = name.replace("Progress", "")
          draft.progress[title].current = event.current
          draft.progress[title].total = event.total
        })
        break

      case 'CacheLoadCompleted':
      case 'ParseCompleted':
        setState((draft) => {
          const title = name.replace("Completed", "")
          draft.progress[title].current = draft.progress[title].total
        })
        break

      case 'ProcessStarted':
        setState((draft) => {
          const title = event.processname
          draft.progress[title] = {
            'title': event.processname,
            'total': event.total,
            'current': 0,
          }
          draft.lines.push({progress: title})
        })
        break

      case 'ProcessProgress':
        setState((draft) => {
          const title = event.processname
          draft.progress[title].current = event.progress
        })
        break

      case 'ProcessFinished':
        setState((draft) => {
          const title = event.processname
          draft.progress[title].current = draft.progress[title].total
        })
        break

      case 'sceneQueueTaskStarted':
      case 'runQueueTaskStarted':
        setState((draft) => {
          if (!draft.setscene_started) {
              draft.setscene_started = true
              draft.lines.push({progress: 'SetScene'})
          }
          if (!draft.tasks_started) {
              draft.tasks_started = true
              draft.lines.push({progress: 'Running'})
          }
          draft.progress['SetScene'] = {
            'title': "Setscene tasks",
            'total': event.stats.setscene_total,
            'current': event.stats.setscene_covered + event.stats.setscene_active + event.stats.setscene_notcovered,
          }
          draft.progress['Running'] = {
            'title': "Running tasks",
            'total': event.stats.total,
            'current': event.stats.completed + event.stats.active + event.stats.failed,
          }
        })
        break

      case 'TaskStarted':
        setState((draft) => {
          const tid = event._fn + ":" + event._task
          const progress = (event._mc !== "default") ? {
            'title': "mc:" + event._mc + ":" + event._package + ":" + event._task,
            'time': Date.now(),
            'pid': event.pid,
          } : {
            'title': event._package + " " + event._task,
            'time': Date.now(),
            'pid': event.pid,
          }
          draft.pidmap[event.pid] = tid
          draft.tasks[tid] = progress
          draft.maxtasks = Math.max(Object.keys(draft.tasks).length, draft.maxtasks)
          draft.lines.push({task: tid})
        })
        break

      case 'TaskProgress':
        setState((draft) => {
          if (event.pid > 0 && event.pid in draft.pidmap) {
            const tid = draft.pidmap[event.pid]
            draft.tasks[tid].progress = event.progress
            draft.tasks[tid].rate = event.rate
          }
        })
        break

      case 'TaskSucceeded':
      case 'TaskFailed':
      case 'TaskFailedSilent':
        setState((draft) => {
          const tid = event._fn + ":" + event._task
          delete draft.tasks[tid]
        })
        break

      default:
        console.log(data)
    }
  }

  function arrange_tasks() {
    if (!state.running) return []
    const tasks = state.lines.filter((a) => {
      if (!("task" in a)) return false
      return a.task in state.tasks
    })
    const active = tasks.map((a) => {
      return state.tasks[a.task]
    })
    for(let i=active.length; i<state.maxtasks; i++) {
      active.push(null)
    }
    return active
  }

  return (
    <>
      <div>
        <button onClick={() => connect()}>{state.connected ? "Disconnect" : "Connect"}</button>
        {" "}{state.status}
      </div>
      <div>
        <pre className="log">
          {state.lines.map((a, i) => {

            if ("msg" in a) {
              return (
                <p key={i}>{a.msg}</p>
              )
            }

            if ("progress" in a) {
              const d = state.progress[a.progress]
              return (
                <p key={i}>{d.title}: <Progress value={d.current} total={d.total} withOf={true} /></p>
              )
            }

            if ("task" in a) {
              return (null)
            }

            // Unknown line entries
            return (
              <code>{JSON.stringify(a, null, 2)}</code>
            )
          })}
        </pre>
        <pre className="log">
          {arrange_tasks().map((a, i) => {
            if (a == null) {
              return <p key={i}>{" "}</p>
            }
            const delta = (Date.now() - a.time)/1000
            return (
              <p key={i}>{i}: {a.title} - <Time seconds={delta} /> (pid {a.pid})  <Progress value={a.progress} total={100} /></p>
            )
          })}
        </pre>
      </div>
    </>
  );
}

export default WebKnotty;
