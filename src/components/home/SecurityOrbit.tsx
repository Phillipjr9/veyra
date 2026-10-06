/** Original SVG light paths; CSS drives them only while their scene is active. */
export function SecurityOrbit() {
  return <svg className="vh-security-network" viewBox="0 0 500 500" fill="none" aria-hidden="true">
    <circle className="vh-network-track" cx="250" cy="250" r="222" />
    <circle className="vh-network-track vh-network-track-inner" cx="250" cy="250" r="188" />
    <g className="vh-network-rays">
      <path d="M250 28V97L302 149" /><path d="M443 140L394 169L361 225" />
      <path d="M442 362L394 334L348 337" /><path d="M250 472V403L217 365" />
      <path d="M57 362L105 334L142 283" /><path d="M57 140L108 169L149 177" />
    </g>
    <g className="vh-network-packets">
      <path d="M250 28V97L302 149" pathLength="100" /><path d="M443 140L394 169L361 225" pathLength="100" />
      <path d="M442 362L394 334L348 337" pathLength="100" /><path d="M250 472V403L217 365" pathLength="100" />
      <path d="M57 362L105 334L142 283" pathLength="100" /><path d="M57 140L108 169L149 177" pathLength="100" />
    </g>
    <g className="vh-network-satellite">
      <circle cx="250" cy="28" r="12" className="vh-network-halo" />
      <circle cx="250" cy="28" r="3" className="vh-network-core" />
      <circle cx="250" cy="472" r="6" className="vh-network-halo" />
      <circle cx="250" cy="472" r="2" className="vh-network-core" />
    </g>
    <g className="vh-network-satellite vh-network-satellite-inner">
      <circle cx="438" cy="250" r="9" className="vh-network-halo" />
      <circle cx="438" cy="250" r="2.5" className="vh-network-core" />
    </g>
    <g className="vh-network-endpoints">
      <circle cx="250" cy="28" r="3" /><circle cx="443" cy="140" r="3" /><circle cx="442" cy="362" r="3" />
      <circle cx="250" cy="472" r="3" /><circle cx="57" cy="362" r="3" /><circle cx="57" cy="140" r="3" />
    </g>
  </svg>;
}
