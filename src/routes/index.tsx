import { createFileRoute } from '@tanstack/react-router'


export const Route = createFileRoute('/')({ component: App })

function App() {
  const features = [
    {
      icon: <span >⚡</span>,
      title: 'Powerful Server Functions',
      description:
        'Write server-side code that seamlessly integrates with your client components. Type-safe, secure, and simple.',
    },
    {
      icon: <span >🗄️</span>,
      title: 'Flexible Server Side Rendering',
      description:
        'Full-document SSR, streaming, and progressive enhancement out of the box. Control exactly what renders where.',
    },
    {
      icon: <span >🛜</span>,
      title: 'API Routes',
      description:
        'Build type-safe API endpoints alongside your application. No separate backend needed.',
    },
    {
      icon: <span >🛡️</span>,
      title: 'Strongly Typed Everything',
      description:
        'End-to-end type safety from server to client. Catch errors before they reach production.',
    },
    {
      icon: <span >🌊</span>,
      title: 'Full Streaming Support',
      description:
        'Stream data from server to client progressively. Perfect for AI applications and real-time updates.',
    },
    {
      icon: <span >✨</span>,
      title: 'Next Generation Ready',
      description:
        'Built from the ground up for modern web applications. Deploy anywhere JavaScript runs.',
    },
  ]

  return (
    <div >
      <section >
        <div ></div>
        <div >
          <div >
            <img
              src="/tanstack-circle-logo.png"
              alt="TanStack Logo"

            />
            <h1 >
              <span >TANSTACK</span>{' '}
              <span >
                START
              </span>
            </h1>
          </div>
          <p >
            The framework for next generation AI applications
          </p>
          <p >
            Full-stack framework powered by TanStack Router for React and Solid.
            Build modern applications with server functions, streaming, and type
            safety.
          </p>
          <div >
            <a
              href="https://tanstack.com/start"
              target="_blank"
              rel="noopener noreferrer"

            >
              Documentation
            </a>
            <p >
              Begin your TanStack Start journey by editing{' '}
              <code >
                /src/routes/index.tsx
              </code>
            </p>
          </div>
        </div>
      </section>

      <section >
        <div >
          {features.map((feature, index) => (
            <div
              key={index}

            >
              <div >{feature.icon}</div>
              <h3 >
                {feature.title}
              </h3>
              <p >
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
