// A small Go domain mirroring the Python and TypeScript fixtures.
package shapes

type Drawable interface {
	Draw() error
}

type Shape struct {
	Name string
}

type Color struct {
	R int
	G int
	B int
}

type Circle struct {
	Shape             // embedded -> inheritance
	Radius     float64
	background *Color // pointer -> association
}

func (c *Circle) Area() float64 { return 3.14 * c.Radius * c.Radius }

func (c Circle) Draw() error { return nil }

// Canvas owns shapes and paints them on a background.
type Canvas struct {
	shapes     []Shape // slice -> aggregation
	background Color    // value -> composition
}

// Add appends a shape so it will be drawn.
func (c *Canvas) Add(s Shape) { c.shapes = append(c.shapes, s) }

type Renderer struct{}

func (r Renderer) Preview() {
	tmp := Circle{} // built and dropped -> dependency
	_ = tmp
}
