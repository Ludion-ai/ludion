// A list of files with a checkbox and a Rename button each, and one delete button for the selection.
export function renderFileList(container, files) {
  container.innerHTML = '';
  const list = document.createElement('ul');
  const remove = document.createElement('button');
  remove.type = 'button';

  const update = () => {
    const n = list.querySelectorAll('input:checked').length;
    remove.textContent = `Delete ${n} ${n === 1 ? 'file' : 'files'}`;
    remove.disabled = n === 0;
  };

  for (const name of files) {
    const item = document.createElement('li');
    item.innerHTML = '<label><input type="checkbox"> <span></span></label> <button type="button">Rename</button>';
    item.querySelector('span').textContent = name;
    item.querySelector('input').addEventListener('change', update);
    list.append(item);
  }

  remove.addEventListener('click', () => {
    for (const box of list.querySelectorAll('input:checked')) box.closest('li').remove();
    update();
  });

  update();
  container.append(list, remove);
}
