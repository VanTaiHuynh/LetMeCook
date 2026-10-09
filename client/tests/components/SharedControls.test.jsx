import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import Button from '../../src/components/ui/Button';
import Field from '../../src/components/ui/Field';
import Alert from '../../src/components/ui/Alert';
it('native shared controls retain labels, keyboard focus, forwarded ref and disabled behavior',async()=>{
 const ref=createRef();const click=vi.fn();render(<><Field htmlFor="fixture-name">Recipe name</Field><input id="fixture-name"/><Button ref={ref} busy onClick={click} className="kitchen-primary">Save recipe</Button><Alert onRetry={click}>Connection lost.</Alert></>);
 expect(screen.getByLabelText('Recipe name')).toBeVisible();expect(ref.current).toBe(screen.getByRole('button',{name:'Save recipe'}));expect(ref.current).toBeDisabled();await userEvent.click(ref.current);expect(click).not.toHaveBeenCalled();await userEvent.click(screen.getByRole('button',{name:'Retry'}));expect(click).toHaveBeenCalledTimes(1);expect(screen.getByRole('alert')).toHaveTextContent('Connection lost.');
});
